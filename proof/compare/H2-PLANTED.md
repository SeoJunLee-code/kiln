# H2: where the three defects were planted

For the people running the comparison. **No agent is given this file**; a run folder holds
only `TASK.md`, `SPEC.md` and `game/`. The spec is [`H2.md`](H2.md).

The starting folders are copies of [`proof/lite/rerun`](../lite/rerun) and
[`proof/lite/godot`](../lite/godot) (without the `.godot` cache) with these lines changed
and nothing else.

| | Kiln, [`h2-start/kiln`](h2-start/kiln) | Godot, [`h2-start/godot`](h2-start/godot) |
|---|---|---|
| (a) door opens one gem early | `level1.kiln`, `gem3`: the trigger got `+despawn:lock2`, so taking gem 3 also removes the lock gem 2 should remove | `src/level_state.gd`, `door_open()`: `gems.is_empty()` became `gems.size() <= 1` |
| (b) a guard stands still | `level2.kiln`, `guard2`: `pace x 1.1 4.1 3` became `pace x 1.1 4.1 0` | `src/levels.gd`, level 2, first guard: path end `(4, 7)` became `(4, 1)`, the same cell as its start |
| (c) caught in level 3 starts level 2 | `level3.kiln`, both guards: `load:level3.kiln` became `load:level2.kiln` (two lines) | `src/main.gd`, `tick()`: `start_level(level_index)` became `start_level(mini(level_index, 1))` |

## Seen headless, 2026-11-27

Before the change both games passed their own tests (Kiln 4 scenes and 3 cases; Godot 48
checks).

- **Kiln**, `kiln test h2-start/kiln`: 3 of 7 fail. `level1.door.input` (the player who
  leaves gem 2 is let through at tick 193): defect (a). `level2.kiln` (the recorded win
  walks into the standing guard) and `level2.caught.input` (the guard never comes to the
  player): defect (b). No test of the game covers (c); a two-line input that walks the
  player into the path of `guard2` of level 3 ends with `load level2.kiln` here and with
  `load level3.kiln` in `proof/lite/rerun`. `check --edition lite`: no error, no warning.
- **Godot**, `godot --headless --path h2-start/godot --script res://tests/run_tests.gd`
  (run on a copy, so that no cache is written into the repository): 10 of 48 fail, exit
  code 1. The three under "B. The door holds": defect (a). Four under "A. Winnable" and
  three under "C. Guards bite": defect (b). No test of the game covers (c); a short script
  that starts level 3, puts the player on a guard and runs one tick reports `Level 2`
  here and `Level 3` in `proof/lite/godot`.

So on both engines the game's own tests point at (a) and (b), and neither has a test that
would show (c): the agent has only the player's report for it.

## Not seen

Nobody has looked at either game on a screen with the defects in it.
