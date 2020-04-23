use once_cell::sync::OnceCell;
use wasm_bindgen::prelude::*;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

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
        hits: &[u8],
        misses: &[u8],
        squids_gotten: i32,
		board_priors: &[f64],
    ) -> Option<([f64; 64], f64)> {
        let hit_mask = make_mask(hits);
        let miss_mask = make_mask(misses);

        let mut total_probability = 0.0;
        let mut probabilities = [0.0; 64];

        for (i, pb) in (&self.boards).iter().enumerate() {
			let board_prob = board_priors[i] * pb.probability;
			if board_prob == 0.0 {
				continue;
			}
            if pb.check_compatible(hit_mask, miss_mask, squids_gotten) {
                for bit_index in 0..64 {
                    if (pb.squids & (1 << bit_index)) != 0 {
                        probabilities[bit_index] += board_prob;
                    }
                }
                total_probability += board_prob;
            }
        }

        if total_probability == 0.0 {
            return None;
        }

        // Renormalize the distribution.
        for i in 0..64 {
            probabilities[i] /= total_probability;
        }

        Some((probabilities, total_probability))
    }

    pub fn do_computation_from_game_history(
        &self,
		board_table: &[u32],
        hits: &[u8],
        misses: &[u8],
        squids_gotten: i32,
		observed_boards: &[u32],
		prior_steps_from_previous_means: &[u32],
		prior_steps_from_previous_stddevs: &[f64],
    ) -> Option<([f64; 64], f64)> {
		// We must compute the boards and their corresponding probabilities from our observations.
		let mut board_priors: Vec<f64> = Vec::with_capacity(604584);
		for _ in 0..604584 {
			board_priors.push(0.0);
		}
		fn gaussian_pdf(x: f64, sigma: f64) -> f64 {
			let mut v = x / sigma;
			return (v * v / -2.0).exp();
		}
		fn scan_from(
			depth: usize, starting_index: usize, prob: f64,
			mut board_priors: &mut Vec<f64>, board_table: &[u32],
			observed_boards: &[u32],
			prior_steps_from_previous_means: &[u32],
			prior_steps_from_previous_stddevs: &[f64],
		) {
			let mu: i64 = prior_steps_from_previous_means[depth] as i64;
			let sigma: f64 = prior_steps_from_previous_stddevs[depth];
			let scan_limit: i64 = (5.0 * sigma) as i64;
			let mean_index: i64 = starting_index as i64 + mu;
			let lower_limit: usize = std::cmp::max(starting_index as i64 + 1, mean_index - scan_limit) as usize;
			let upper_limit: usize = std::cmp::min(board_table.len() as i64, mean_index + scan_limit) as usize;
			if depth == observed_boards.len() {
				// Fill in our final smeared prior.
				for i in lower_limit..upper_limit {
					let offset = i as i64 - (starting_index as i64 + mu);
					board_priors[board_table[i] as usize] += prob * gaussian_pdf(offset as f64, sigma);
				}
			} else {
				for i in lower_limit..upper_limit {
					if board_table[i] == observed_boards[depth] {
						// Compute the normal prior, but ignore normalization, because that's handled at the end by do_computation anyway.
						let offset = i as i64 - (starting_index as i64 + mu);
						let adjustment = gaussian_pdf(offset as f64, sigma);
						scan_from(
							depth + 1, i, prob * adjustment,
							&mut board_priors, &board_table,
							&observed_boards,
							&prior_steps_from_previous_means,
							&prior_steps_from_previous_stddevs,
						);
//						scan_from(depth + 1, i, prob * adjustment, board_priors, board_table);
					}
				}
			}
		}
		scan_from(
			0, 0, 1.0,
			&mut board_priors, &board_table,
			&observed_boards,
			&prior_steps_from_previous_means,
			&prior_steps_from_previous_stddevs,
		);

		//*
		// Have some vanishing prior on every other possible board, just so we avoid giving up if we were wrong.
		for i in 0..604584 {
//			board_priors[i] = 0.0;
			board_priors[i] += 1e-10;
		}
//		board_priors[prior_steps_from_previous_stddevs[0] as usize] = 1.0;
		// */
		/*
		if board_table.len() > 1000 {
			for i in 0..100 {
				let index = board_table[i] as usize;
				if index < board_priors.len() {
					board_priors[board_table[i] as usize] += 1.0;
				}
//				board_priors[i] += 1.0;
			}
		}
		*/

		self.do_computation(hits, misses, squids_gotten, &board_priors)
	}
}

static POSSIBLE_BOARDS: OnceCell<PossibleBoards> = OnceCell::new();
static BOARD_TABLE: OnceCell<Vec<u32>> = OnceCell::new();

// Calculates the probabilities for each cell based on the hits, misses and the
// squids that have already been killed.
#[wasm_bindgen]
pub fn calculate_probabilities_with_board_constraints(
	hits: &[u8],
	misses: &[u8],
	squids_gotten: i32,
	board_constraints: &[u32],
	constraint_probs: &[f64],
) -> Option<Vec<f64>> {
	let mut board_priors: Vec<f64> = Vec::with_capacity(604584);
	for _ in 0..604584 {
		board_priors.push(if board_constraints.len() == 0 { 1.0 } else { 0.0 });
	}
	for (board_index, prior_prob) in board_constraints.iter().zip(constraint_probs) {
		board_priors[*board_index as usize] = *prior_prob;
	}

    let (probabilities, total_probability) = POSSIBLE_BOARDS
        .get_or_init(PossibleBoards::new)
        .do_computation(hits, misses, squids_gotten, &board_priors)?;

    let mut values = probabilities.iter().copied().collect::<Vec<_>>();

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
	let fake_board_table = vec!{1, 2, 3, 4, 5, 6, 7, 9, 10};

	let board_table = match BOARD_TABLE.get() {
		Some(v) => v,
		None => &fake_board_table,
	};

    let (probabilities, total_probability) = POSSIBLE_BOARDS
        .get_or_init(PossibleBoards::new)
        .do_computation_from_game_history(
			board_table,
			hits,
			misses,
			squids_gotten,
			observed_boards,
			prior_steps_from_previous_means,
			prior_steps_from_previous_stddevs,
		)?;

    let mut values = probabilities.iter().copied().collect::<Vec<_>>();

    // We sneak in the total probability at the end.
    values.push(total_probability);

    Some(values)
}

#[wasm_bindgen]
pub fn set_board_table(board_table: &[u32]) -> () {
	BOARD_TABLE.set(board_table.iter().copied().collect::<Vec<_>>());
}

#[cfg(test)]
mod tests {
    use crate::PossibleBoards;

    #[test]
    fn test() {
        PossibleBoards::new().do_computation(&[], &[], -1, &[], &[]).unwrap();
    }
}
