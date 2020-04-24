
# Sploosh Kaboom FAQ

- [What is Sploosh Kaboom?](#what-is-sploosh-kaboom)
- [Why is Sploosh Kaboom required for hundo?](#why-is-sploosh-kaboom-required-for-wind-waker-100)
- [Solving Sploosh Kaboom](#solving-sploosh-kaboom)
  - [Examining the Statistics](#examining-the-statistics)
  - [Examining the Code](#examining-the-code)
    - [Board generation Algorithm](#board-generation-algorithm)
    - [RNG Algorithm](#rng-algorithm)
  - [Solving the Game](#solving-the-game)
  - [Worked Example](#worked-example)
- [Running the Program](#running-the-program)
- [Feedback](#feedback)
- [Credits](#temporary-credit-page)
  
## What is Sploosh Kaboom?

Sploosh Kaboom is a minigame in Legend of Zelda: The Wind Waker similar to the 
classic board game Battleship. In it, the player is presented with an empty board
within which three ships of varying length are hidden. A player can fire at a
given grid location and will be presented with a KABOOM if a ship is hit,
or a SPLOOSH on a miss. The object of the game is to hit and elimate all ships
within 24 shots. A ship is elimiated if all grid spaces it occupies are fired 
upon. 

## Why is Sploosh Kaboom Required for Wind Waker 100%? 

The Wind Waker 100% rules dictate that all Treasure Charts and Heart Pieces 
must be collected. Sploosh Kaboom grants a Piece of Heart on Link's first win
and a treasure chart on his second. If Link wins in under twenty shots, he 
recieves another tresure chart. Due to these items, a 100% Speedrun of 
The Wind Waker must complete the Sploosh Kaboom minigame twice and win at 
least once in under twenty shots. 

## Solving Sploosh Kaboom

Sploosh Kaboom is a largely luck based game. If we list all the possible ship
layouts of the game, we arrive at 604,584 valid board configurations. In Wind
Waker, the position and orientation of the ships is determined randomly for 
each play of the game. How, then, can we consistently complete this mini-game
in a time senitive context like a speedrun? 

### Examining the Statistics

Sploosh Kaboom play can be optimized by examining the statistical odds of ship
positioning on the board. By generating every possible valid ship configuration,
we can perform statistically optimal play by use of a simple alogorithm:

1. Generate every possible board configuration that results in a valid ship
placement. This results in 604,584 possible boards. Initialize a board working set
with all these boards.
2. Determine the probability each board space contains a ship by checking what
fraction of the working board set has a ship in that space. 
3. Fire upon whatever empy space has the highest statistcal odds of containing a 
ship.
4. Based on the current game state (hits, misses, unchecked spaces, eliminated 
ship count), determine what subset of the board working set is consistent with 
the game state. This subset is the new board working set.
5. Repeat from step (2) until the game is complete.

This statistics-based algorithm can be further refined by optimizing opening 
patterns to quickly find ships and elimiate board possibilities. This algorithm 
makes the most-likely choice at each step of the game, which won't necessarily
make the best moves overall. However, it is known from analysis of Battleship that
this type of algorithm is close to optimal. 

### Examining the Code

In order to exactly understand Sploosh Kaboom, it is necessary to examine the 
code used to generate boards. This code can be obtained from the Wind Waker
game binary by Reverse Engineering techniques. We can determine the section of
code dedicated to the generation of Sploosh Kaboom boards by examining memory 
during gameplay. This can be accomplished using the Dolphin Emulator and a 
memory monitoring tool called Dolphin Memory Engine. Once the relevant segment
of the code is determined, it can be reverse engineered from machine code into
a C approximation using PowerPC reverse engineering tools. Ghidra was used to 
approximate the C code for the Sploosh Kaboom board generation algorithm and
the Random Number Generator of Wind Waker. Pseudocode of the findings are as 
follows:

#### Board generation Algorithm

```C

void setup_sk_board(struct SKStruct* sk_struct, int ship_count)
{
    // blank out the Sploosh Kaboom board
    zero_sk_board(sk_struct);

    if(ship_count == 2)
    {
        place_sk_ship(sk_struct, 0, 2);
        place_sk_ship(sk_struct, 1, 3);
    }
    ...
    else if(ship_count < 4)
    {
        // this is the configuratino actually used in the game
        place_sk_ship(sk_struct, 0, 2);
        place_sk_ship(sk_struct, 1, 3);
        place_sk_ship(sk_struct, 2, 4);
    }
}

void place_sk_ship(struct SKStruct* sk_struct, int ship_idx, int ship_length)
{
    bool is_empty = true;
    int orientation, x, y;

    do
    {
      // keep trying random orientations and
      // x/y pos until ship fits on board
      // RNG_func() returns a double in the domain [0, 1)
      orientation = (int)(RNG_func() * 2.0);
      x = (int)(RNG_func() * 8.0);
      y = (int)(RNG_func() * 8.0);
      // check if proposed ship fits on board and spaces aren't 
      // occupied
      is_empty = check_sk_ship_fits(sk_struct, orientation, x, y, ship_length);
    } while(isEmpty);

    if(orientation)
    {
        //place ship veritcally
    }
    else
    {
        //place ship horizontally
    }
}

```

The full reverse engineered code can be found [here](https://pastebin.com/010PBgnm). 

#### RNG Algorithm

Wind Waker makes use of the Wichmann–Hill PRNG, presented in pseudocode as 
follows:

``` C

double iterate_rng(double& s1, double& s2, double& s3)
{
    s1 = mod(171 * s1, 30269);
    s2 = mod(172 * s2, 30307);
    s3 = mod(170 * s3, 30323);

    return mod(s1/30269.0 + s2/30307.0 + s3/30323.0, 1);
}
```

This generator makes use of three linear congruental generators that are then 
combined to produce a distribution between zero and one. This generator is
initialized on console reboot to `s1 = s2 = s3 = 100`, a fixed initial seed.
The values of `(s1, s2, s3)` at any given time determine what the next value
of the random number generator will be. We can call this the "state" of the 
random number generator. 

### Solving the Game

Due to the fixed initial seed on console reboot, we can determine every random
number that the PRNG algoritm will generate for use by the game. Since we know
the exact algorithm used to generate a Sploosh Kaboom board configuration, we 
can determine what board configuration a given starting RNG state will create.
Due to the fixed initial seed of the RNG algorithm detailed above, we can 
"play forward" the RNG and generate out all future return values for the RNG
algorithm. During normal gameplay, the RNG is advanced by a variety of different
game elements at a rate of about 10 - 1000 steps per frame. This means that in the
first hour of gameplay, the RNG state is advanced on the order of 200 million times.
We can generate a board state for each of those future values from the moment of 
console boot up out to some arbitrarily large maximum. We then have a mapping of 

`RNG State -> generated board`

for an arbitrarily large number of RNG states proceeding from the moment the console is turned on. We can then generate a reverse mapping of

`board ship placement` -> `Possible RNG States`

for every board that can occur. If we create a map of a sufficiently large amount of 
RNG steps, we can cover all possible RNG states for when Sploosh Kaboom is reached 
in a run. If the runner then completes a single game of sploosh, we index into the reverse
map with the board of that attempt. 

`reverse_map[board1] -> rng_state_set`

This gives us a set of possible RNG states the game could have been in at the 
time of board generation. We know approximately how long a game takes and 
approximately how many times the RNG algorithm is called during that game, so 
we can step each possible RNG state by that amount of calls. Due to uncertainty 
in how quickly the game was played and exactly how many times the RNG function 
was stepped, we create a window around each possible RNG state index and add those 
states in the window to the possible RNG state set. 

```
foreach state in rng_state_set {
  rng_state_set.add(nearbyStates(state))
}
```

We now take all our set of RNG states and create a set of possible boards using our 
forward map. 

```
possible_boards = []

foreach state in rng_state_set {
  possible_boards.add(forward_map[state])
}
```

Those boards can then be used to play optimally with the statistical 
algorithm. After each subsequent game is completed, the set of possible RNG states
can be further narrowed based on which indices within the RNG state map are 
consistent with both known boards. Once sufficiently narrowed, the set of RNG states
becomes small enough we can predict the ship positionings very accurately. 

### Worked Example

Say a runner arrives at sploosh-kaboom after approximately 45 minutes of gameplay. 

1. The RNG state will have advanced from the fixed seed of `(100, 100, 100)` on the
order of 100 Million times

2. The runner plays sploosh kaboom and enters the ship
locations observed at the end of the game into the program

3. The program determines the given board to be board number 157238 of the ~600,000 
possible. 

4. The board can be used to look up
`board -> rng state set` 
in the map.
We now have a set of RNG states we may have been at the moment the board generation
took place. This set consists of RNG states like 
`(1256, 25792, 319), (256, 1020, 1557)...`.

5. For each RNG state in this set, we move forward in the RNG sequence by approximately
the amount of RNG cycles used during a Sploosh game (on the order of 1000 steps). Expand
this set in either direction along the RNG sequence from each memeber of the set, for instance
if the set contains RNG state numbers 
`(1123456, 9484594, ....)` 
expand it the set to 
`(...1123455, 1123456, 1123457..., ...9484593, 9484594, 9484595, ...)`. 
This margin for error must be large enough to account for variation in the RNG step rate 
and play time of a sploosh game.

6. Generate a set of possible boards from the expanded set of possible RNG states. 

7. Use this set of boards as the working set used in the statiscal method used above with
greatly improved win odds.

8. After a second game has been completed, enter the ship positions observed. 

9. We now revisit our set of RNG states from step (4). The second board will likely be
present in the margin of error states of a very small subset of the RNG state set, if not in
exactly one state. We can then extend from the smaller subset of RNG states as we did 
in step (5). 

10. For the third game we now have an extremely small number of possible boards, so the 
statistical method detailed above will be able to predict where the squids are with very high
accuracy. 

## Running the program

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.<br />
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br />
You will also see any lint errors in the console.

### `yarn test`

Launches the test runner in the interactive watch mode.<br />
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `yarn build`

Builds the app for production to the `build` folder.<br />
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br />
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `yarn eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Feedback

Want to suggest feedback? Log an issue under the "Issues" tab. 

Want to discuss this tool further in depth? Join the [Linkus7 Discord](https://discord.gg/linkus7), and chat in the #sploosh-kaboom channel.

## Temporary credit page

This is incomplete and just a random listing of those that have contributed in the #sploosh-kaboom channel:

 - PeterSchmidtNielsen (TTV: FrobeniusEndomorphism) \[The GOAT\]
 - Cryze
 - ginkgo
 - TrogWW
 - Langufo
 - csunday95
 - the NSA for the beautiful piece of software called Ghidra
 - aldelaro for Dolphin Memory Engine
 - the inimitable Dolphin Devs 
 - Linkus7 for complaining about sploosh enough to summon an army
