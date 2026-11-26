# Lite proof game: Gem Vault

A written spec for one small game. An agent builds it from this text alone, and the
same text is later given to an agent on another engine. Nothing here names an engine
feature.

## The game

A top-down game on a grid, seen from above, played with the four arrow keys. Three
levels and an end screen.

1. The player walks in four directions and is stopped by walls.
2. Every level holds gems. Walking onto a gem collects it.
3. Every level has one exit door. The door is closed, and blocks the player like a wall,
   until every gem of that level is collected. Then it opens.
4. Walking through the open door starts the next level. After level 3 comes an end
   screen that shows the words `You win`.
5. From level 2 on there are guards. A guard walks back and forth along a fixed straight
   path, forever. Touching a guard starts the current level again from its beginning,
   with every gem back.
6. Level 3 has crates. The player pushes a crate by walking into it; a crate does not
   move through walls. At least one gem of level 3 cannot be reached until a crate
   has been pushed out of the way.
7. Every level shows its name on screen (`Level 1`, `Level 2`, `Level 3`).

## Minimum size

| Level | Grid at least | Gems | Guards | Crates |
|---|---|---|---|---|
| 1 | 9 x 7 | 3 | 0 | 0 |
| 2 | 11 x 9 | 4 | 2 | 0 |
| 3 | 13 x 9 | 4 | 2 | 2 |

In levels 2 and 3 at least one guard's path must cross the route the winning player
takes, so that winning requires timing and not only walking.

## What "done" means

All of it is checked by the engine's own headless tools, without a person looking.

- **A. Winnable.** For each level there is a recorded input that wins it from a fresh
  start: every gem collected, then the exit taken. The engine's test command replays it
  and passes.
- **B. The door holds.** A test proves that in level 1 a player who walks to the door
  without collecting every gem does not leave the level.
- **C. Guards bite.** A test proves that in level 2 a player who touches a guard is sent
  back to the start of level 2.
- **D. The crate matters.** A test proves that in level 3 the gem behind the crate is
  not collected by a player who never pushes a crate.
- **E. Lite.** The whole game needs nothing above the Lite edition, and the engine's
  validation reports no errors and no warnings for any file of the game.
- **F. One folder.** Every file of the game is inside the folder `game/`, and the test
  command given that folder passes as a whole.

When done, list the files and say, for each of A to F, which file proves it.
