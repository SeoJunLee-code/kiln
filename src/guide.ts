import { schemaText } from './scene.ts';
import { registry } from './world.ts';

/**
 * Parts of the manual that only some games need. The core guide names each topic and its
 * components in one line; `guide TOPIC` prints the rest. A component joins a topic through
 * the last argument of defineComponent.
 */
export const TOPICS: Record<string, { about: string; text: string }> = {
  physics: {
    about: 'bodies that fall, tumble, collide',
    text: `Put physics=rapier on the world line. An entity with rigid + pos + box is a dynamic body.
solid entities and solid tiles are fixed colliders. Movers (pos+vel+box, such as the ctrl
character) stop at a body, shove it by their weight, and can stand and ride on it.
A body that hits a mover moves it a little, more the heavier the body (a mover weighs its
box's volume); one that a force keeps pushing takes the mover along, never through a solid.
pos, vel and quat of a rigid show where the backend has it, rounded. A script moves a body
by writing them: pos puts it somewhere, vel sets its speed, quat x y z w its turn, sx sy sz
its spin. What the script does not write keeps its exact value. Or add a push:
w.add(id, 'impulse', { x, y, z }), through the centre of mass (no turning force). 3D only.
Saving a running physics scene as text and loading it does not continue exactly; run it
from the start with the same input instead.`,
  },
  view: {
    about: 'turning, animation, cameras, labels',
    text: `None of these change collision, triggers or solve: they see the unturned box.
2D shows rot about z only. 3D needs an entity with eye. Check the picture with look.
Animation (2D): draw the frames in one image, side by side, all the same size and looking
right (PNG, or SVG with a viewBox), and give the entity sprite image=walk.png + anim 4.
The frame comes from the tick alone: tick*fps/hz, so a replay draws the same pictures.
anim 4 idle=1 keeps frame 0 for standing and loops 1..3 while vel is not zero.
Looking left mirrors the picture; face is saved with the scene and is part of the hash.`,
  },
  levels: {
    about: 'a score or lives, kept across scenes',
    text: `A value that lasts is a component, and tally is the ready-made one:
entity score
  pos 7 0.9
  label Coins:_%          % shows n
  tally coin              +1 for every coin event; tally hit 3 -1 is three lives
  keep tally
Put the same entity, with the same keep line, in the scene that load: opens. There it
starts with the n it had when the first scene ended (the tick of the load event), not
with what its own file says. keep takes any components, a script's own too: keep tally,bag.
A scene run by itself starts from its file. test --follow carries values as the player
does, and both reach the same hash. Check a value with: expect at N score.tally.n == 2`,
  },
};

/** One part of the manual. Its component list is generated from the registry. */
export function topicText(topic: string): string {
  const t = TOPICS[topic];
  return `KILN GUIDE: ${topic}  (${t.about})
${t.text}

COMPONENTS
${schemaText(topic)}`;
}

/** The lines of the core guide that say what else there is to read. */
function topicIndex(): string {
  return Object.entries(TOPICS).map(([name, t]) => {
    const comps = [...registry.values()].filter((c) => c.topic === name).map((c) => c.name).join(' ');
    return `${name}: ${comps}  -- ${t.about}`;
  }).join('\n');
}

/**
 * The core manual, sized to be read by an agent in one call. The component list is
 * generated from the registry, so it cannot drift from the code. A test keeps it short.
 */
export function guideText(): string {
  return `KILN GUIDE
A scene is a text file, NAME.kiln. Run it headless; same scene + same input = same result.

SCENE
world hz=60 gravity=X,Y[,Z] [seed=N] [physics=rapier]   once, optional
entity NAME                              then components, indented 2 spaces
  COMPONENT value value name=value       positional or by name; [x=..] below marks optional
prefab NAME                              a component list without pos, used by tiles spawn
use ./file.ts                            load a script (see SCRIPTS)
expect ...                               a check (see EXPECT)
# comment
Units: 1 = one cell. y grows DOWN (above the floor = smaller y). z is depth, 3D only.

COMPONENTS
${schemaText('').trimEnd()}

MORE COMPONENTS  read \`guide TOPIC\` (MCP: cmd=guide topic=TOPIC) before using one
${topicIndex()}

TILES  rows follow the tiles line, indented 4 spaces, one character per cell, '.' = empty
entity map
  pos 0 0
  tiles spawn=@:hero,o:coin
    #####
    #@.o#
    #####
A spawned prefab used once keeps its name (hero); used several times it is numbered
(coin1, coin2). Tag those and refer to them as #tag.

EXPECT  A and B are entity names or #tags; N is a tick
expect reach A B by N        A overlaps B at some tick <= N
expect never A B             A never overlaps B
expect gone A by N           A (or all with that #tag) was despawned
expect event NAME by N       a trigger emitted NAME
expect count NAME OP VALUE at N       NAME events emitted by tick N
expect at N A.comp.field OP VALUE     OP: < <= > >= == !=

INPUT  one per line: TICK ACTION down|up     actions: left right up down a b

COMMANDS  (CLI: node src/cli.ts CMD SCENE [options]; MCP: tool kiln, argument cmd)
check    parse and validate (a folder: every scene). Says the edition the game needs: lite runs
         anywhere; [standard] parts need WebGPU (drawing) or megabytes more (physics). --edition lite: more is an error
test     run, evaluate expects; --input FILE; exit 1 if any fails. A folder: every scene
         with its NAME.input, then once per NAME.CASE.input. expect lines in an input
         replace the scene's. --follow: go on into
         the scene a load: opened, with its NAME.input
run      run without judging; --ticks N
solve    find an input meeting reach/gone/event, keeping never and count X == 0; --out FILE saves it
schema   components only
look     picture of the game view from a headless browser, with what is in it;
         --tick N --input FILE --out FILE.png (needs Chrome/Edge)
play     open in a browser (CLI only); what you press is recorded as an input script
Add to test/run: --view (ASCII picture), --top (3D floor plan), --observe
(positions), --events.

OUTPUT
ok ... / fail ...                        last line of every command
pass|FAIL file:line EXPECT -- what happened
E CODE file:line message (hint: ...)     all errors at once; fix all, rerun
W CODE file message (hint: ...)          check only: runs, but part of it does nothing

WORKFLOW
1. Write the scene with expects that say what "working" means.
2. check, then solve. If solve fails, it prints the goal still open and a picture of
   the furthest attempt: fix the level there.
3. Save the input with --out and keep test passing as you change things.

SCRIPTS  only when components cannot express the rule
export default (k) => {
  k.component('name', 'doc', [{ name: 'f', type: 'fx' }]);   // types: fx int str; def = default
  k.system((w) => { for (const id of w.query('name', 'pos')) { const c = w.get(id, 'name'); } });
};
World: w.query(...comps) ids ascending, w.get(id, comp), w.add(id, comp, data), w.spawn(name),
w.despawn(id), w.match(nameOrTag), w.on(action), w.emit(event), w.rand(), w.tick.
Numbers of type fx are fixed-point: k.fx(1.5), k.mul(a, b), k.div(a, b), k.ONE. No floats,
no Math.random, no Date; keep state in components, not in variables.
`;
}
