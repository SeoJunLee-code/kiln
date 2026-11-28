# Sealed held-out specs

Six specs written on 2026-11-28 and sealed by hash before any change to the engine that
followed [`PLAN-NEXT.ko.md`](../../../PLAN-NEXT.ko.md). They are the only specs a win or a
loss may be claimed on from here (plan, step E). H1, H2 and H3 have been seen and are
development specs now.

| File | Kind | Screen checks |
|---|---|---|
| [`S1.md`](S1.md) | 2D from the side with a rule of its own (thrust runner) | 12 |
| [`S2.md`](S2.md) | 3D with physics (lap race) | 17 |
| [`S3.md`](S3.md) | changing a game that exists (five changes to the S1 game) | 10 |
| [`S4.md`](S4.md) | mostly interface, mouse (life board) | 14 |
| [`S5.md`](S5.md) | two players (paddle duel) | 16 |
| [`S6.md`](S6.md) | sound carries the game (brick breaker) | 16 |

## Rules

- **The seal.** [`SEAL.sha256`](SEAL.sha256) holds the SHA-256 of each spec file as
  committed. Check with `sha256sum -c SEAL.sha256` in this folder (the files are stored
  with LF line ends; `.gitattributes` here keeps them so). A spec whose hash no longer
  matches is not a held-out spec.
- **The engine is not changed for them.** No guide text, component, example or test is
  written with these files open. A session working on the engine does not read `S*.md`;
  it reads this file only.
- **One count each.** A spec is run once per setup on a pinned engine commit, three runs,
  by the rules of [`docs/EDITIONS.md`](../../../docs/EDITIONS.md), "Winning, not only
  matching". After that it is a development spec.
- **Half at a time.** First S1, S2 and S4. If Kiln loses, the engine is changed and S5, S6
  and S3 are the second set (S3 needs the S1 games, which exist by then).
- **Run and judged on the owner's machine**, not here: the runs need the headless agent
  program and the Godot executable, and passing is judged by a person on the screen.

## What weakens the seal, said plainly

- The plan asked for the text to be kept outside the repository with only the hashes
  committed. The session that wrote them ran in a container that is thrown away, so the
  text is committed here in the open. The hashes show the specs were not changed
  afterwards; they cannot show nobody read them.
- **The same session wrote these specs and then changed the engine.** It wrote them first,
  before opening any engine source file in that session, with the plan, the handoff notes
  and the three earlier results read. It knew the engine's weak points from those
  documents. The owner choosing the specs would have been cleaner (plan, "for the owner
  to decide", item 3).
- **The source pages were not fetched.** The public list (the 20 Games Challenge) could
  not be reached from where these were written. Each spec names the entry it follows from
  memory, quotes nothing, and marks what was added. The owner should compare each with
  its page before opening it, and may replace any of them: a replaced spec gets a new
  hash and the old line is struck, not edited.
- S3's starting game does not exist until S1 has been run.
- Nothing here has been run, on either engine. A check that turns out to be impossible to
  judge is dropped for both engines alike, and that is recorded with the result.
