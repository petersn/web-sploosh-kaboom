# Live version: https://peter.website/web-sploosh-kaboom/

# Sploosh Kaboom FAQ

- [What is Sploosh Kaboom?](#what-is-sploosh-kaboom)
  - [Why is Sploosh Kaboom Required for Hundo?](#why-is-sploosh-kaboom-required-for-the-wind-waker-100)
- [Solving Sploosh Kaboom](#solving-sploosh-kaboom)
  - [Examining the Statistics](#examining-the-statistics)
  - [Examining the Code](#examining-the-code)
    - [Board Generation Algorithm](#board-generation-algorithm)
    - [RNG Algorithm](#rng-algorithm)
  - [Solving the Game](#solving-the-game)
  - [Worked Example](#worked-example)
- [Feedback](#feedback)
- [Credits](#temporary-credit-page)

# Sploosh Kaboom Solution Write-Up

## What is Sploosh Kaboom?

Sploosh Kaboom is a minigame in The Legend of Zelda: The Wind Waker similar to
the classic board game Battleship. In it, the player is presented with an empty
board within which three squid groups of varying length are hidden. A player can
fire at a given grid location and will be presented with a KABOOM if a squid is
hit, or a SPLOOSH on a miss. The object of the game is to hit and eliminate all
three groups within 24 shots. A group is eliminated if all its squids are hit.

### Why is Sploosh Kaboom Required for The Wind Waker 100%?

The Wind Waker 100% rules dictate that all Treasure Charts and Pieces of Heart
must be collected. Sploosh Kaboom grants a Piece of Heart on Link's first win
and a Treasure Chart on his second. If Link wins in under 20 shots, he receives
another Treasure Chart. Due to these items, a 100% speedrun of The Wind Waker
must complete the Sploosh Kaboom minigame twice and win at least once in under
20 shots.

## Solving Sploosh Kaboom

Sploosh Kaboom is a largely luck-based game. If we list all the possible board
layouts of the game, we arrive at 604,584 valid board configurations. In The
Wind Waker, the position and orientation of the squids is determined randomly
for each play of the game. How, then, can we consistently complete this minigame
in a time-sensitive context like a speedrun?

### Examining the Statistics

Sploosh Kaboom play can be optimized by examining the statistical odds of squid
positioning on the board. By generating every possible valid configuration, we
can perform statistically optimal play by use of a simple algorithm:

1. Generate every possible board configuration that results in valid squid
placements. This results in 604,584 possible boards. Initialize a working board
set with all these boards.
2. Determine the probability each board space contains a squid by checking what
fraction of the working board set has a squid in that space.
3. Fire upon whatever unchecked space has the highest statistical odds of
containing a squid.
4. Based on the current game state (hits, misses, unchecked spaces, and
eliminated group count), determine what subset of the working board set is
consistent with the game state. This subset is the new working board set.
5. Repeat from step (2) until the game is complete.

This statistics-based algorithm can be further refined by optimizing opening
patterns to quickly find squids and eliminate board possibilities. This
algorithm makes the most likely choice at each step of the game, which won't
necessarily make the best moves overall. However, it is known from analysis of
Battleship that this type of algorithm is close to optimal.

### Examining the Code

In order to exactly understand Sploosh Kaboom, it is necessary to examine the
code used to generate boards. This code can be obtained from The Wind Waker's
game binary by Reverse Engineering techniques. We can determine the section of
code dedicated to the generation of Sploosh Kaboom boards by examining memory 
during gameplay. This can be accomplished using the Dolphin Emulator and a 
memory monitoring tool called Dolphin Memory Engine. Once the relevant segment
of the code is determined, it can be reverse engineered from machine code into
a C approximation using PowerPC reverse engineering tools. Ghidra was used to 
approximate the C code for the Sploosh Kaboom board generation algorithm and
the Random Number Generator of The Wind Waker. Pseudocode of the findings is as
follows:

#### Board Generation Algorithm

```c
board = [8×8 integer grid]      // board[i][j] means the value at col i, row j

function generate():  // generates a board layout
    // empty the board
    for x from 0 to 8:
        for y from 0 to 8:
            board[x][y] = 0

    // place the ships
    place(0,2)  // first #0 of length 2
    place(1,3)  // then #1 of length 3
    place(2,4)  // then #2 of length 4

function place(shipNumber, shipLength):  // places a single ship on the board
    // generate ships until one fits
    // rng() gives a uniformly "random" decimal 0 ≤ x < 1, increments the rng state
    infinite loop:
        orientation = floor(rng() * 1000) % 2 // vert. or horiz., 0 or 1, equally-likely
        x = floor(rng() * 8)            // top/left squid's col, 0–7, equally-likely
        y = floor(rng() * 8)            // top/left squid's row
        if fits(x,y,shipLength,orientation):
            exit loop                   // we've now determined x, y and orientation

    // place ship
    if orientation == 0:
        for j from 0 to shipLength:             // for each squid
            board[x][y+j] = 102 + shipNumber    // put 102/103/104 in relevant tile
    else:
        for i from 0 to shipLength:
            board[x+i][y] = 102 + index

function fits(x, y, shipLength, orientation):  // would the ship fit?
    if orientation == 0:
        for j from 0 to shipLength:     // for each tile
            if x > 7 or y+j > 7:        // is it out-of-bounds?
                return False
            if board[x][y+j] > 100:     // does it already have a squid in it?
                return False
        return True                     // we've checked every tile by now
    else:
        for i from 0 to shipLength:
            if x+i > 7 or y > 7:
                return False
            if board[x+i][y] > 100:
                return False
        return True
```

The full reverse engineered code can be found [here](https://pastebin.com/010PBgnm). 

#### RNG Algorithm

The Wind Waker makes use of the Wichmann-Hill PRNG, presented in pseudocode as
follows:

``` C
double rng() {
    static int s1 = 100, s2 = 100, s3 = 100;

    s1 = (171 * s1) % 30269;
    s2 = (172 * s2) % 30307;
    s3 = (170 * s3) % 30323;

    return fmod(s1/30269.0 + s2/30307.0 + s3/30323.0, 1.0);
}
```

This generator makes use of three linear congruential generators that are then
combined to produce a distribution between zero and one. This generator is
initialized on console reboot to `s1 = s2 = s3 = 100`, a fixed initial seed.
The values of `(s1, s2, s3)` at any given time determine what the next value
of the random number generator will be. We can call this the "state" of the 
random number generator. Each iteration of the RNG will advance the seed values
and generate a new random return value. The first few steps of this process 
can be seen below:

| s1         | s2         | s3         | return value        | 
|  ----:     |  ----:     |  ---:      |  ---:               |
|      100.0 |      100.0 |      100.0 |  0.6930906199656834 |
|    17100.0 |    17200.0 |    17000.0 |  0.5253911237999249 |
|    18276.0 |    18621.0 |     9315.0 |  0.1491021216452075 |
|     7489.0 |    20577.0 |     6754.0 |  0.9526796411193339 |
|     9321.0 |    23632.0 |    26229.0 |  0.8229855100670485 |
|    19903.0 |     3566.0 |     1449.0 |  0.8003992983171554 |
|    ...     |     ...    |     ...    |  ...                |

We can then use the board generation algorithm above to generate a mapping of RNG 
states to the board it would generate in the game. 

### Solving the Game

Due to the fixed initial seed on console reboot, we can determine every random
number that the PRNG algorithm will generate for use by the game. Since we know
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

`board layout` -> `Possible RNG States`

for every board that can occur. If we create a map of a sufficiently large amount of 
RNG steps, we can cover all possible RNG states for when Sploosh Kaboom is reached 
in a run. If the runner then completes a single game, we index into the reverse
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
becomes small enough we can predict the squid positionings very accurately.

### Worked Example

Say a runner arrives at Sploosh Kaboom after approximately 45 minutes of
gameplay.

1. The RNG state will have advanced from the fixed seed of `(100, 100, 100)` on the
order of 100 Million times.

2. The runner plays Sploosh Kaboom and enters the squid locations observed at
the end of the game into the program.

3. The program determines the given board to be board number 157238 of the ~600,000 
possible. 

4. The board can be used to look up
`board -> rng state set` 
in the map.
We now have a set of RNG states we may have been at the moment the board generation
took place. This set consists of RNG states like 
`(1256, 25792, 319), (256, 1020, 1557)...`.

5. For each RNG state in this set, we move forward in the RNG sequence by approximately
the amount of RNG cycles used during a game (on the order of 1000 steps). Expand
this set in either direction along the RNG sequence from each member of the set.
For instance, if the set contains RNG state numbers `(1123456, 9484594, ...)`,
expand it to the set
`(...1123455, 1123456, 1123457..., ...9484593, 9484594, 9484595, ...)`. 
This margin for error must be large enough to account for variation in the RNG step rate 
and play time of a game.

6. Generate a set of possible boards from the expanded set of possible RNG states. 

7. Use this set of boards as the working set used in the statistical method used above with
greatly improved win odds.

8. After a second game has been completed, enter the squid positions observed.

9. We now revisit our set of RNG states from step (4). The second board will likely be
present in the margin of error states of a very small subset of the RNG state set, if not in
exactly one state. We can then extend from the smaller subset of RNG states as we did 
in step (5). 

10. For the third game, we now have an extremely small number of possible
boards, so the statistical method detailed above will be able to predict where
the squids are with very high accuracy.

## Feedback

Want to suggest feedback? Log an issue under the "Issues" tab. 

Want to discuss this tool further in depth? Join the [Linkus7 Discord](https://discord.gg/linkus7), and chat in the #sploosh-kaboom channel.

## Temporary Credit Page

This is incomplete and just a random listing of those that have contributed in the #sploosh-kaboom channel:

 - Peter Schmidt-Nielsen
 - Cryze
 - ginkgo
 - TrogWW
 - Langufo
 - csunday95
 - shoutplenty
 - the NSA for the beautiful piece of software called Ghidra
 - aldelaro for Dolphin Memory Engine
 - the inimitable Dolphin Devs 
 - Linkus7 for complaining about sploosh enough to summon an army
