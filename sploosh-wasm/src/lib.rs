use once_cell::sync::OnceCell;
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

struct SquidStartingDesc {
    x: u64,
    y: u64,
    direction: bool,
}

impl SquidStartingDesc {
    fn is_valid(&self, mut taken_so_far: u64, length: u64) -> Option<u64> {
        for offset in 0..length {
            let mut nx = self.x;
            let mut ny = self.y;
            if self.direction {
                nx += offset;
            } else {
                ny += offset;
            }
            if nx > 7 || ny > 7 {
                return None;
            }
            let bit = 1 << (nx + 8 * ny);
            if (taken_so_far & bit) != 0 {
                return None;
            }
            taken_so_far |= bit;
        }
        Some(taken_so_far)
    }
}

fn count_valid_children(
    starting_descs: &[SquidStartingDesc; 128],
    taken_so_far: u64,
    length: u64,
) -> usize {
    starting_descs
        .iter()
        .filter_map(|desc| desc.is_valid(taken_so_far, length))
        .count()
}

macro_rules! or_continue {
    ($e:expr) => {
        match $e {
            Some(v) => v,
            None => continue,
        }
    };
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

pub struct History {
    observed_boards: Vec<u32>,
    means: Vec<u32>,
    stds: Vec<f64>,
}

pub struct PossibleBoards {
    boards: Vec<PossibleBoard>,
}

impl PossibleBoards {
    pub fn new() -> Self {
        let starting_descs: [_; 128] = array_init::from_iter((0..8).flat_map(|y| {
            (0..8).flat_map(move |x| {
                [false, true]
                    .iter()
                    .map(move |&direction| SquidStartingDesc { x, y, direction })
            })
        }))
        .unwrap();

        let mut possible_boards = Vec::with_capacity(604584);

        // count up the valid placements
        let mask0 = 0;

        let children0 = count_valid_children(&starting_descs, mask0, 2);
        for squid2_desc in starting_descs.iter() {
            let mask1 = or_continue!(squid2_desc.is_valid(mask0, 2));

            let children1 = count_valid_children(&starting_descs, mask1, 3);
            for squid3_desc in starting_descs.iter() {
                let mask2 = or_continue!(squid3_desc.is_valid(mask1, 3));

                let children2 = count_valid_children(&starting_descs, mask2, 4);
                for squid4_desc in starting_descs.iter() {
                    let mask3 = or_continue!(squid4_desc.is_valid(mask2, 4));

                    possible_boards.push(PossibleBoard {
                        squids: mask3,
                        squid2: mask1,
                        squid3: mask2 & !mask1,
                        squid4: mask3 & !mask2,
                        probability: 1.0 / (children0 * children1 * children2) as f64,
                    });
                }
            }
        }

        Self {
            boards: possible_boards,
        }
    }

    pub fn do_computation(
        &self,
        state: &GameState,
        board_priors: &[f64],
    ) -> Option<([f64; 64], f64)> {
        let hit_mask = make_mask(&state.hits);
        let miss_mask = make_mask(&state.misses);

        let mut total_probability = 0.0;
        let mut probabilities = [0.0; 64];

        for (i, pb) in (&self.boards).iter().enumerate() {
            if pb.check_compatible(hit_mask, miss_mask, state.squids_gotten) {
                let board_prob = 1e-20 * pb.probability + board_priors[i];
                for (bit_index, probability) in probabilities.iter_mut().enumerate() {
                    if (pb.squids & (1 << bit_index)) != 0 {
                        *probability += board_prob;
                    }
                }
                total_probability += board_prob;
            }
        }

        if total_probability == 0.0 {
            return None;
        }

        // Renormalize the distribution.
        for probability in probabilities.iter_mut() {
            *probability /= total_probability;
        }

        Some((probabilities, total_probability))
    }

    pub fn compute_board_priors(
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

    pub fn do_computation_from_game_history(
        &self,
        board_table: &[u32],
        state: &GameState,
        history: &History
    ) -> Option<([f64; 64], f64)> {
        let board_priors: Vec<f64> = self.compute_board_priors(
            board_table,
            history,
        );
        self.do_computation(state, &board_priors)
    }

    pub fn disambiguate_final_board(
        &self,
        board_table: &[u32],
        hits: &[u8],
        history: &History,
    ) -> Option<u32> {
        let mut board_priors: Vec<f64> = self.compute_board_priors(
            board_table,
            history,
        );

        let hit_mask = make_mask(hits);
        for (i, pb) in (&self.boards).iter().enumerate() {
            if ! pb.check_compatible(hit_mask, 0, 3) {
                board_priors[i] = 0.0;
            }
        }

        // Normalize the prior.
        let mut total = 1e-20;
        for p in &board_priors {
            total += *p;
        }
        for p in &mut board_priors {
            *p /= total;
        }

        for (i, p) in board_priors.iter().enumerate() {
            if *p > 0.9 {
                return Some(i as u32);
            }
        }

        None
    }
}

static POSSIBLE_BOARDS: OnceCell<PossibleBoards> = OnceCell::new();
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
    let board_priors = vec![0.0; 604584];
    let (probabilities, total_probability) = POSSIBLE_BOARDS
        .get_or_init(PossibleBoards::new)
        .do_computation(&state, &board_priors)?;

    let mut values = probabilities.to_vec();

    // We sneak in the total probability at the end. With the way this value
    // is calculated, it ranges from 0 to about 1e-20. We scale it up here, to
    // range from 0 to about 1.
    values.push(total_probability * 1e20);

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
        .get_or_init(PossibleBoards::new)
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
        .get_or_init(PossibleBoards::new)
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
        let priors = vec![0.0; 604584];
        PossibleBoards::new().do_computation(&state, &priors).unwrap();
    }
}
