# Third-party material

The engine's core (`src/`, `web/`) has no dependency and contains no third-party code.

| What | Where it is used | Licence |
|---|---|---|
| [Rapier](https://rapier.rs) 0.21.0, deterministic WASM build (`@dimforge/rapier3d-deterministic-compat`) | the optional physics backend, `backends/rapier/`, installed from the registry at a pinned version; not vendored | Apache-2.0 |
| [Godot Engine](https://github.com/godotengine/godot) 4.7.2 | read for design, defaults and API shapes ([`docs/GODOT-NOTES.md`](docs/GODOT-NOTES.md)). **No code was copied or translated.** If that changes, the file that carries it names its origin and the notice below applies to it | MIT |
| [The 20 Games Challenge](https://20gameschallenge.com) | the public task list the held-out specs under `proof/compare/` follow; their text is rewritten, with what was added marked | MIT (© 2022 Matthew S) |
| Godot 4.7.2 as a tool | exported two glTF test models (`examples/godot/`, see `examples/ASSETS.md`); the other side of the comparison in `proof/compare/` | MIT |

Nothing from Godot's own `thirdparty/` folder was read for reuse; those libraries carry
their own licences.

## Godot Engine notice (for anything taken from it)

Copyright (c) 2014-present Godot Engine contributors.
Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
