# Rapier backend

Rigid bodies for scenes that say `world ... physics=rapier`. Kiln's core has no
dependencies; this folder is the one place that has one, and it is optional.

    npm ci --prefix backends/rapier

It installs exactly one package, [`@dimforge/rapier3d-deterministic-compat`](https://rapier.rs)
0.21.0 (Apache-2.0), pinned by the lockfile. It is Rapier's deterministic WebAssembly
build: the same steps give the same bits on every machine, which is what lets a physics
scene keep a state hash (`spikes/RESULTS.md` has the test behind that; `tests/physics.test.ts`
pins a hash that CI compares on three OSes).

`index.ts` adapts it to the interface in `src/physics.ts`. Another engine would be
another folder here with the same default export; scenes would not change.
