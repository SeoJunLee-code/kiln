# Contributing to Kiln

Thanks for looking. Kiln is early, so small, focused changes are the easiest to review and merge.

## Setup

Node 24 or newer. There is nothing to install and nothing to build.

```
npm test
node scripts/hashes.ts --check
```

Both must pass before a pull request. CI runs them on Linux, macOS and Windows.

## Rules that keep the engine what it is

1. **No floats in the simulation.** Code under `src/` that changes world state uses the fixed-point helpers in `src/fx.ts`. Floats are fine for drawing (`web/`) and for reporting.
2. **No hidden nondeterminism.** No `Math.random`, clocks, or iteration over unordered data in the simulation. Use `world.rand()` and `world.query()` (ascending ids).
3. **No runtime dependencies.** The engine runs from a fresh clone. If a dependency looks necessary, open an issue first.
4. **Node runs the TypeScript directly.** That means no `enum`, no constructor parameter properties, `import type` for types, and `.ts` in import paths.
5. **Errors are for machines first.** A new error gets a `K` code, a `file:line`, and a hint that says what to do. Report all errors you can find, not only the first.
6. **Output is compact.** CLI and MCP output is read by agents that pay per token. Prefer one short line to a paragraph.
7. **Do not claim what was not measured.** Performance and size claims in docs need a script in the repo that reproduces them.

## If an example hash changes

`examples/HASHES` records the final state hash of every example. If your change is meant to alter simulation results, run `node scripts/hashes.ts --write` and say why in the pull request. If you did not expect a change, that is a bug to find.

## Tests

Tests live in `tests/` and use Node's built-in runner. A behavior change needs a test that fails without it. Prefer testing through scenes and `run()` over testing internals.

## Good first areas

- More `expect` forms (for example comparing two entities, or counting entities with a tag).
- Collision shapes beyond boxes.
- A tilemap component and its ASCII view.
- Trying the MCP server with a real agent and reporting where it wastes tokens.

## License

By contributing you agree that your contribution is licensed under the MIT license of this repository.
