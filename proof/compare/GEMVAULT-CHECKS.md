# Gem Vault: screen pass checks

Pass checks for [`proof/lite/SPEC.md`](../lite/SPEC.md), written 2026-11-27 before the
spread runs were looked at. Gem Vault is the development spec: the engine was changed for
it, so it is not counted for or against any engine. These checks exist to try the method
(a person, the screen, the keyboard) and to say which spread runs passed.

The spec's own "What done means" is checked by the agent with the engine's headless tools.
These checks do not use them. They are the same for every engine and need no knowledge of
how the game was built.

## How the game is started

The game is run as the agent left it, in the engine's ordinary way, from a copy of `game/`:

- Kiln: `node src/cli.ts play game/FIRST.kiln`, where FIRST is the scene of level 1, and
  the page it prints is opened in a browser.
- Godot: `godot --path game`.

The judge uses the four arrow keys and nothing else. If a game needs any other key, a
mouse click or a restart of the program to go on, the check that needed it fails. A game
may be started again from the beginning between checks.

## Checks

Every check is "do this, see that". A check fails if the screen does not show it, however
the game's files read.

| # | Do | See |
|---|---|---|
| 1 | Start the game. | A grid seen from above with walls, one player, gems, a door, and the words `Level 1`. No error message on the screen or in the window the game was started from. |
| 2 | Press each arrow key in open floor. | The player moves up, down, left and right, in the direction of the key. |
| 3 | Walk into a wall and keep the key down for two seconds. | The player stops at the wall and does not pass through or into it. |
| 4 | Count on the screen. | Level 1 is at least 9 cells wide and 7 high and holds at least 3 gems, no guard and no crate. |
| 5 | Walk onto a gem. | The gem disappears and does not come back. |
| 6 | With at least one gem left, walk to the door and into it for two seconds. | The player is stopped by the door. The screen still says `Level 1`. |
| 7 | Collect every gem of level 1, then walk through the door. | The door is seen to open or to be gone, the player passes, and the screen shows `Level 2`. |
| 8 | In level 2, count, then watch for ten seconds without pressing a key. | At least 11 by 9 cells, at least 4 gems, at least 2 guards. Each guard moves back and forth along one straight line and keeps doing so. |
| 9 | In level 2, collect one gem, then walk into a guard. | The level starts again: the player is at its starting cell, every gem is back, the screen says `Level 2`. |
| 10 | Win level 2: every gem, then the door. | The screen shows `Level 3`. On the way at least one guard's line crosses cells the player had to pass. |
| 11 | In level 3, count. | At least 13 by 9 cells, at least 4 gems, at least 2 guards, at least 2 crates. |
| 12 | Walk into a crate that has open floor behind it. Then push a crate against a wall and keep the key down for two seconds. | The crate moves one way with the player. Against the wall neither the crate nor the player moves on, and the crate is not inside the wall. |
| 13 | Look at level 3 before pushing anything; then try to reach every gem without touching a crate. | At least one gem has a crate on every way to it and cannot be collected without a push. |
| 14 | In level 3, collect one gem, then walk into a guard. | The level starts again with every gem and every crate back, and the screen says `Level 3`. |
| 15 | Win level 3: push the crate, every gem, then the door. | An end screen with the words `You win`. |

A game passes when all fifteen hold. A level that cannot be won by a person in ten tries
fails the check that asks for the win, and the checks after it are not reached; they count
as failed.

## What these checks leave out

- They do not look at frame rate, size, or how the game looks beyond being readable.
- Check 13 is judged by eye. A gem that is in fact reachable by a route the judge did not
  see passes wrongly. The spec's own test D covers that case for the engine it ran on.
- Ten tries is the judge's patience, not a measure of difficulty.

## Who judges

A person, who also records the screen. **No run has been judged this way yet.** What was
done without a person for the spread runs is in [`SPREAD.md`](SPREAD.md): the agent's own
test command run again, and the sizes counted from the files.
