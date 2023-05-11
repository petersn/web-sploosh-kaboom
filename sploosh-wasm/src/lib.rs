use once_cell::sync::OnceCell;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::Mutex;
use wasm_bindgen::prelude::*;

struct PossibleBoard {
    squids: u64,
    squid2: u64,
    squid3: u64,
    squid4: u64,
    probability: f64,
}

impl PossibleBoard {
    fn check_compatible(&self, hit_mask: u64, miss_mask: u64, squids_gotten: i32) -> bool {
        if (hit_mask & !self.squids) != 0 {
            return false;
        }
        if (miss_mask & self.squids) != 0 {
            return false;
        }
        if squids_gotten == -1 {
            return true;
        }
        let mut squids_hit = 0;
        squids_hit += ((self.squid2 & !hit_mask) == 0) as i32;
        squids_hit += ((self.squid3 & !hit_mask) == 0) as i32;
        squids_hit += ((self.squid4 & !hit_mask) == 0) as i32;
        squids_hit == squids_gotten
    }
}

#[derive(Copy, Clone)]
enum Orientation {
    Horizontal,
    Vertical
}

struct SquidStartingDesc {
    x: u64,
    y: u64,
    direction: Orientation,
}

impl SquidStartingDesc {
    fn board_mask(&self, taken_so_far: u64, length: u64) -> Option<u64> {
        let (changing_value, shift) = match self.direction {
            Orientation::Horizontal => (self.x, 1),
            Orientation::Vertical => (self.y, 8),
        };
        if changing_value + length > 8 {
            return None;
        }
        let first_bit = 1 << (self.x + 8 * self.y);
        let squid_bits = (0..length).map(|x| first_bit << (x * shift))
                                    .reduce(|a, bit| a | bit).unwrap();
        if (taken_so_far & squid_bits) != 0 {
            return None;
        }
        Some(squid_bits)
    }
}

fn get_compatible_masks(
    starting_descs: &[SquidStartingDesc; 128],
    taken_so_far: u64,
    length: u64,
) -> Vec<u64> {
    starting_descs
        .iter()
        .filter_map(|desc| desc.board_mask(taken_so_far, length))
        .collect()
}

fn make_mask(bits: &[u8]) -> u64 {
    let mut result = 0;
    for &bit_index in bits {
        result |= 1 << bit_index;
    }
    result
}

pub struct GameState {
    hits: Vec<u8>,
    misses: Vec<u8>,
    squids_gotten: i32,
}

#[derive(PartialEq, Clone)]
pub struct History {
    observed_boards: Vec<u32>,
    means: Vec<u32>,
    stds: Vec<f64>,
}

pub struct PossibleBoards {
    boards: Vec<PossibleBoard>,
    priors_cache: RefCell<VecDeque<(History, Vec<f64>)>>,
}

impl PossibleBoards {
    pub fn new() -> Self {
        let starting_descs: [_; 128] = array_init::from_iter((0..8).flat_map(|y| {
            (0..8).flat_map(move |x| {
                [Orientation::Vertical, Orientation::Horizontal]
                    .iter()
                    .map(move |&direction| SquidStartingDesc { x, y, direction })
            })
        }))
        .unwrap();

        let mut possible_boards = Vec::with_capacity(604584);

        // Due to the board sampling method, there is a bias towards certain boards.
        // We need to store these biases to provide accurate guesses.
        let compatible_masks = get_compatible_masks(&starting_descs, 0u64, 2);
        let combinations_2 = compatible_masks.len();

        for mask_2 in compatible_masks {
            let compatible_masks = get_compatible_masks(&starting_descs, mask_2, 3);
            let combinations_23 = combinations_2 * compatible_masks.len();

            for mask_3 in compatible_masks {
                let mask_23 = mask_2 | mask_3;
                let compatible_masks = get_compatible_masks(&starting_descs, mask_23, 4);
                let combinations_234 = combinations_23 * compatible_masks.len();

                for mask_4 in compatible_masks {
                    possible_boards.push(PossibleBoard {
                        squids: mask_23 | mask_4,
                        squid2: mask_2,
                        squid3: mask_3,
                        squid4: mask_4,
                        probability: 1.0 / combinations_234 as f64,
                    });
                }
            }
        }

        assert_eq!(possible_boards.len(), 604584);

        Self {
            boards: possible_boards,
            priors_cache: RefCell::new(VecDeque::with_capacity(16)),
        }
    }

    pub fn do_computation(
        &self,
        state: &GameState,
        board_priors: Option<&[f64]>,
    ) -> Option<([f64; 64], f64)> {
        let hit_mask = make_mask(&state.hits);
        let miss_mask = make_mask(&state.misses);

        let mut total_probability = 0.0;
        let mut probabilities = [0.0; 64];

        // If a list of priors is given, use them to try to create a heatmap.
        // Otherwise, use the general probabilities expected based on the board
        // generation algorithm.
        if let Some(board_priors) = board_priors {
            for (board, &prior) in self.boards.iter().zip(board_priors) {
                if prior > 0.0 &&
                    board.check_compatible(hit_mask, miss_mask, state.squids_gotten) {
                    for (bit_index, probability) in probabilities.iter_mut().enumerate() {
                        if (board.squids & (1 << bit_index)) != 0 {
                            *probability += prior;
                        }
                    }
                    total_probability += prior;
                }
            }
            // If the priors don't include the possibility of this state,
            // fall back to the general probabilities.
            if total_probability == 0.0 {
                return self.do_computation(state, None);
            }
        } else {
            for board in self.boards.iter() {
                if board.check_compatible(hit_mask, miss_mask, state.squids_gotten) {
                    for (bit_index, probability) in probabilities.iter_mut().enumerate() {
                        if (board.squids & (1 << bit_index)) != 0 {
                            *probability += board.probability;
                        }
                    }
                    total_probability += board.probability;
                }
            }
            // If no boards have matched, this state is actually impossible.
            if total_probability == 0.0 {
                return None;
            }
        }

        // Renormalize the distribution.
        for probability in probabilities.iter_mut() {
            *probability /= total_probability;
        }

        Some((probabilities, total_probability))
    }

    fn compute_board_priors(
        &self,
        board_table: &[u32],
        history: &History,
    ) -> Vec<f64> {
        // We must compute the boards and their corresponding probabilities from our observations.
        let mut board_priors = vec![0.0; 604584];
        fn gaussian_pdf(x: f64, sigma: f64) -> f64 {
            let z = x / sigma;
            (z * z / -2.0).exp()
        }
        fn scan_from(
            depth: usize, starting_index: usize, prob: f64,
            board_priors: &mut Vec<f64>, board_table: &[u32],
            history: &History,
        ) {
            let mu: i64 = history.means[depth] as i64;
            let sigma: f64 = history.stds[depth];
            let scan_limit: i64 = (5.0 * sigma) as i64;
            let mean_index: i64 = starting_index as i64 + mu;
            let lower_limit: usize = std::cmp::max(starting_index as i64 + 1, mean_index - scan_limit) as usize;
            let upper_limit: usize = std::cmp::min(board_table.len() as i64, mean_index + scan_limit) as usize;
            if depth == history.observed_boards.len() {
                // Fill in our final smeared prior.
                for i in lower_limit..upper_limit {
                    let offset = i as i64 - (starting_index as i64 + mu);
                    board_priors[board_table[i] as usize] += prob * gaussian_pdf(offset as f64, sigma);
                }
            } else {
                for i in lower_limit..upper_limit {
                    if board_table[i] == history.observed_boards[depth] {
                        // Compute the normal prior, but ignore normalization, because that's handled at the end by do_computation anyway.
                        let offset = i as i64 - (starting_index as i64 + mu);
                        let adjustment = gaussian_pdf(offset as f64, sigma);
                        scan_from(
                            depth + 1, i, prob * adjustment,
                            board_priors, board_table,
                            history,
                        );
                    }
                }
            }
        }
        scan_from(
            0, 0, 1.0,
            &mut board_priors, board_table,
            history,
        );
        board_priors
    }

    pub fn get_board_priors(
        &self,
        board_table: &[u32],
        history: &History,
    ) -> impl std::ops::Deref<Target = Vec<f64>> + '_ {
        let match_index = self.priors_cache.borrow().iter().position(
            |(cached_history, _)| *history == *cached_history
        );
        match match_index {
            Some(i) => {
                // Move the matched entry to mark most recently used.
                if i != 0 {
                    let mut priors_cache = self.priors_cache.borrow_mut();
                    let entry = priors_cache.remove(i).unwrap();
                    priors_cache.push_front(entry);
                }
            },
            None => {
                let mut priors_cache = self.priors_cache.borrow_mut();
                // Remove the least recently used entry if we're at capacity.
                if priors_cache.len() == priors_cache.capacity() {
                    priors_cache.pop_back();
                }

                let board_priors = self.compute_board_priors(
                    board_table,
                    history,
                );
                priors_cache.push_front((history.clone(), board_priors));
            }
        };
        // Expose just the priors that are of interest without copying them.
        std::cell::Ref::map(self.priors_cache.borrow(), |c| &c.front().unwrap().1)
    }

    pub fn do_computation_from_game_history(
        &self,
        board_table: &[u32],
        state: &GameState,
        history: &History
    ) -> Option<([f64; 64], f64)> {
        let board_priors = self.get_board_priors(board_table, history);
        self.do_computation(state, Some(&board_priors))
    }

    pub fn disambiguate_final_board(
        &self,
        board_table: &[u32],
        hits: &[u8],
        history: &History,
    ) -> Option<u32> {
        let mut match_indices = Vec::new();
        let hit_mask = make_mask(hits);
        for (i, board) in self.boards.iter().enumerate() {
            if board.check_compatible(hit_mask, 0, 3) {
                match_indices.push(i);
            }
        }

        let best_match = match match_indices.len() {
            0 => None,
            // If there is only one possible match, it must be correct,
            // even if its prior probability is 0 based on the history.
            1 => Some(&match_indices[0]),
            // Return one of the possible boards based on confidence.
            _ => {
                let board_priors = self.get_board_priors(board_table, history);
                let total = match_indices.iter()
                                         .map(|&i| board_priors[i])
                                         .sum::<f64>();
                // We need a match with a positive prior to disambiguate.
                if total == 0.0 {
                    None
                } else {
                    // Require 90% confidence in a match to return it.
                    match_indices.iter().find(|&&board_index|
                        board_priors[board_index] / total > 0.9
                    )
                }
            }
        };
        best_match.map(|&m| std::convert::TryInto::try_into(m).unwrap())
    }
}

static POSSIBLE_BOARDS: OnceCell<Mutex<PossibleBoards>> = OnceCell::new();
static BOARD_TABLE: OnceCell<Vec<u32>> = OnceCell::new();

// Calculates the probabilities for each cell based on the hits, misses and the
// squids that have already been killed.
#[wasm_bindgen]
pub fn calculate_probabilities_without_sequence(
    hits: &[u8],
    misses: &[u8],
    squids_gotten: i32,
) -> Option<Vec<f64>> {
    let state = GameState {
        hits: hits.to_vec(),
        misses: misses.to_vec(),
        squids_gotten,
    };
    let (probabilities, total_probability) = POSSIBLE_BOARDS
        .get_or_init(|| Mutex::new(PossibleBoards::new()))
        .lock()
        .unwrap()
        .do_computation(&state, None)?;

    let mut values = probabilities.to_vec();

    // We sneak in the total probability at the end.
    values.push(total_probability);

    Some(values)
}

#[wasm_bindgen]
pub fn calculate_probabilities_from_game_history(
    hits: &[u8],
    misses: &[u8],
    squids_gotten: i32,
    observed_boards: &[u32],
    prior_steps_from_previous_means: &[u32],
    prior_steps_from_previous_stddevs: &[f64],
) -> Option<Vec<f64>> {
    let fake_board_table = vec![];
    let board_table = match BOARD_TABLE.get() {
        Some(v) => v,
        None => &fake_board_table,
    };
    let state = GameState {
        hits: hits.to_vec(),
        misses: misses.to_vec(),
        squids_gotten,
    };
    let history = History {
        observed_boards: observed_boards.to_vec(),
        means: prior_steps_from_previous_means.to_vec(),
        stds: prior_steps_from_previous_stddevs.to_vec(),
    };

    let (probabilities, total_probability) = POSSIBLE_BOARDS
        .get_or_init(|| Mutex::new(PossibleBoards::new()))
        .lock()
        .unwrap()
        .do_computation_from_game_history(
            board_table,
            &state,
            &history,
        )?;

    let mut values = probabilities.to_vec();

    // We sneak in the total probability at the end.
    values.push(total_probability);

    Some(values)
}

#[wasm_bindgen]
pub fn disambiguate_final_board(
    hits: &[u8],
    observed_boards: &[u32],
    prior_steps_from_previous_means: &[u32],
    prior_steps_from_previous_stddevs: &[f64],
) -> Option<u32> {
    let fake_board_table = vec![];
    let board_table = match BOARD_TABLE.get() {
        Some(v) => v,
        None => &fake_board_table,
    };
    let history = History {
        observed_boards: observed_boards.to_vec(),
        means: prior_steps_from_previous_means.to_vec(),
        stds: prior_steps_from_previous_stddevs.to_vec(),
    };

    POSSIBLE_BOARDS
        .get_or_init(|| Mutex::new(PossibleBoards::new()))
        .lock()
        .unwrap()
        .disambiguate_final_board(
            board_table,
            hits,
            &history,
        )
}

#[wasm_bindgen]
pub fn set_board_table(board_table: &[u32]) {
    BOARD_TABLE.set(board_table.to_vec()).unwrap();
}

#[cfg(test)]
mod tests {
    use crate::GameState;
    use crate::PossibleBoards;

    #[test]
    fn test() {
        let state = GameState {
            hits: vec![],
            misses: vec![],
            squids_gotten: -1,
        };
        PossibleBoards::new().do_computation(&state, None).unwrap();
    }
}
