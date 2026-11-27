# Agent tooling for Godot: the candidates

The third setup of the comparison is "the other engine with the best agent tooling there is
for it". This is the survey behind the choice. Read on 2026-11-27 from each project's
GitHub page and README through the GitHub API. **Nothing here was installed or run.**
Stars are a count of interest, not of quality.

## What the setup needs

A run starts headless in a folder with an empty `game/`, with nobody at the machine.

1. The server starts from the command line (`--mcp-config`) and needs no open editor and
   no add-on already inside the project: at the start there is no project.
2. Free, with a licence that lets anyone repeat the run.
3. Works with Godot 4.7 on Windows.
4. Gives the agent what the file-tools setup lacks. In the one Godot run so far the agent
   never saw its game and wrote its own test runner; Kiln's agent has `look` (a picture)
   and replayed input. So: run the game, read its output, see it, press keys.

## Candidates

| Project | Stars | Licence | Last push | How it runs | Needs 1-4 |
|---|---|---|---|---|---|
| `Coding-Solo/godot-mcp` | 6,781 | MIT | 2026-04-16 | `npx`, drives the Godot executable | 1, 2, 3 yes. 4 in part: runs the project and returns its output; no picture, no input |
| `Erodenn/godot-mcp-runtime` | 103 | MIT | 2026-11-13 (release v4.0.1, 2026-11-11) | `npx`, drives the Godot executable, Godot 4.5 or later, Node 20 or later | all four: 43 tools; headless scene editing; `run_project` puts a bridge in the running game for screenshots, key and mouse input, the live scene tree, running a script; a background mode that does not show the window on Windows |
| `yurineko73/Godot-MCP-Native` | 882 | MIT | 2026-08-03 | a plug-in inside the editor | fails 1 |
| `youichi-uda/godot-mcp-pro` | 649 | not an open licence (paid) | 2026-11-26 | editor plug-in, 162 tools | fails 1 and 2 |
| `ee0pdt/Godot-MCP` | 624 | MIT | 2025-03-19 | editor plug-in | fails 1; no push in twenty months |
| `tugcantopaloglu/godot-mcp` | 528 | MIT | 2026-10-09 | 157 tools | not read beyond its description |
| `tomyud1/godot-mcp` | 458 | MIT | 2026-10-17 | server and editor plug-in | fails 1 |
| `IvanMurzak/Godot-MCP` | 387 | Apache-2.0 | 2026-11-25 | not read beyond its description | |
| `satelliteoflove/godot-mcp` | 193 | MIT | 2026-11-16 | works in the editor | fails 1 |
| `beckettlab/beckett-godot-mcp` | 54 | MIT (the free tier) | 2026-11-01 | a plug-in inside the editor | fails 1 |
| GDAI MCP | n/a | paid | n/a | editor plug-in | fails 1 and 2 |

Comparisons published on the web were found only from a company that sells a competing
product; they were not used.

## Choice

**`godot-mcp-runtime`, pinned to v4.0.1**, as the "agent tools" setup. It is the only
candidate read that meets all four needs, and the fourth is the one that decides whether an
agent can check its own game. `Coding-Solo/godot-mcp` is by far the most used and stays the
fallback: if the chosen server does not work on this machine with Godot 4.7.2 in a trial
run, the fallback is used and that is written down before any counted run.

Planned configuration (from its README, not yet tried):

```json
{ "mcpServers": { "godot": { "command": "npx", "args": ["-y", "godot-mcp-runtime@4.0.1"],
  "env": { "GODOT_PATH": "PATH/TO/Godot_v4.7.2-stable_win64.exe", "GODOT_MCP_DISABLE_ELICITATION": "true" } } } }
```

The second variable turns off its ask-before-launch prompt, which a headless run cannot
answer. The file tools and the `godot` command stay as in the file-tools setup; the
server's tools are added to the allowed list.

## Open

- A trial run (not counted) of this setup: does the server start under
  `--strict-mcp-config`, does `run_project` work headless with nobody logged in to a
  desktop session, do screenshots come back. Installing it runs code from the package
  registry; the package is 2.7 MB unpacked.
- 43 tool definitions are read by the model on every turn. That cost belongs to the setup
  and is counted, as Kiln's one tool and its guide are.
- The two unread candidates with many tools (`tugcantopaloglu`, `IvanMurzak`) should be read
  before the counted runs; if one of them meets all four needs and is clearly more used,
  the choice is made again, before any counted run and not after.
