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
        let starting_descs: [_; 128] = array_init::from_iter((0..8).flat_map(|x| {
            (0..8).flat_map(move |y| {
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
    ) -> Option<([f64; 64], f64)> {
        let hit_mask = make_mask(hits);
        let miss_mask = make_mask(misses);

        let mut total_probability = 0.0;
        let mut probabilities = [0.0; 64];

        for pb in &self.boards {
            if pb.check_compatible(hit_mask, miss_mask, squids_gotten) {
                for bit_index in 0..64 {
                    if (pb.squids & (1 << bit_index)) != 0 {
                        probabilities[bit_index] += pb.probability;
                    }
                }
                total_probability += pb.probability;
            }
        }

        if total_probability == 0.0 {
            return None;
        }

        // renormalize the distribution
        for i in 0..64 {
            probabilities[i] /= total_probability;
        }

        Some((probabilities, total_probability))
    }
}

static POSSIBLE_BOARDS: OnceCell<PossibleBoards> = OnceCell::new();

/// Calculates the probabilities for each cell based on the hits, misses and the
/// squids that have already been killed.
#[wasm_bindgen]
pub fn calculate_probabilities(hits: &[u8], misses: &[u8], squids_gotten: i32) -> Option<Vec<f64>> {
    let (probabilities, total_probability) = POSSIBLE_BOARDS
        .get_or_init(PossibleBoards::new)
        .do_computation(hits, misses, squids_gotten)?;

    let mut values = probabilities.iter().copied().collect::<Vec<_>>();

    // We sneak in the total probability at the end.
    values.push(total_probability);

    Some(values)
}

#[cfg(test)]
mod tests {
    use crate::PossibleBoards;

    #[test]
    fn test() {
        PossibleBoards::new().do_computation(&[], &[], -1).unwrap();
    }
}
