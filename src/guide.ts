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
    text: `Put physics=rapier on the world line. rigid + pos + box is a dynamic body.
Shape: rigid box|ball|capsule|cylinder|cone (box gives the size; the last three stand along
y with radius w/2). solid entities and solid tiles are fixed colliders. Movers (pos+vel+box, such as the ctrl
character) stop at a body, shove it by their weight, and can stand and ride on it.
A body that hits a mover moves it a little, more the heavier the body (a mover weighs its
box's volume); one that a force keeps pushing takes the mover along, never through a solid.
pos, vel, quat of a rigid show the backend's, rounded. A script moves a body
by writing them: pos puts it somewhere, vel sets its speed, quat x y z w its turn, sx sy sz
its spin. What it does not write stays exact. Or add a push:
w.add(id, 'impulse', { x, y, z }), through the centre of mass (no turning force). 3D only.
A physics scene saved as text mid-run does not continue exactly: rerun from the start.
Joints: "joint KIND TO [x y z]" on a rigid ties it to another entity (rigid, solid or mover)
or to world. x y z is where it holds, from this centre, as placed at the start.
  joint hinge world 0 0.5 axis=z       a pendulum; min= max= limit the angle in degrees
  joint hinge frame -1 axis=y motor=90 power=50     motor: degrees/second, power: most torque
  joint slider world axis=x min=-2 max=2            slides along an axis (motor in units/second)
  joint ball link1 0 0.5               a chain link; joint fixed other welds two together
  joint rope world 0 3                 joint spring world 0 3 stiff=40 damp=2
rope, spring: from this centre to the other's (or, with world, this one's) moved by x y z;
length=0 is the distance at the start. Joined bodies do not collide with each other.
Scripts may change motor, power, min, max, or drop the component.`,
  },
  nav: {
    about: 'enemies and others that find their way',
    text: `nav TO speed [reach] walks an entity with pos, box and vel to TO (a name or #tag, the
nearest one), around solid entities that stand still and solid tiles:
  entity wolf
    pos 1 1
    box 0.8 0.8
    vel
    nav hero 3 event=bitten     % emits bitten once it is within reach
reach: how near counts as there (centre to centre; 0: onto it). plane=xz: a 3D floor.
cell (1) is the grid of the search: set it to the tile size. 8 directions, corners are
not cut, the mover's own size counts. It re-plans at every cell, so moved targets and
opened doors are noticed; movers do not avoid each other. With no way through it goes as
close as it can. Not for side-view jumping. Scripts retarget with w.get(id,'nav').to.`,
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
  ui: {
    about: 'buttons, screen layout',
    text: `pin puts an entity at a place on the screen instead of in the world; it needs no pos and
the camera does not move it. Its box and offsets are in screen units: 1 = a twelfth of the
shorter side of the view, so it fits a phone and a wide window alike.
entity start
  pin center              or top-left top top-right left right bottom-left bottom bottom-right
  box 4 1.2
  sprite color=teal
  label Start             drawn inside the box, because this is a button
  button start load:level1.kiln key=a
entity score
  pin top-right -0.3 0.3  no box: the text itself sits in the corner, 0.3 units in
  label Coins:_%
  tally coin
A click or tap on a button's box emits its event and does its action; key=a lets the a
key (Z, Space, a pad's A) press it too. A button with pos instead of pin is in the world.
A press is input, so it is recorded and replays headless. In an input file:
12 start tap              the button's entity name; the event comes in the next tick
solve never taps: give test an input with the taps. 2D only. Check the picture with look.`,
  },
  audio: {
    about: 'samples on events, music',
    text: `Without sound the browser player plays a short tone for every event. With it, only
what you list is heard:
entity audio
  sound coin:coin.wav,hit:hit.wav music=tune.ogg vol=0.8 mvol=0.4
EVENT:FILE plays the file each time that event is emitted (a trigger's event, a script's
w.emit, load). music loops. vol and mvol, 0..1, are the loudness of samples and of music.
Files are .wav, .mp3 or .ogg beside the scene. One sound line per scene; put it in every
scene that should sound (the music starts again in each).
A browser gives no sound before the first key, tap or pad button, so the music starts
there. M mutes. Nothing in the game can read sound: headless runs and solve skip it, and
no expect can hear it. check warns about a missing file and an event nothing emits.`,
  },
  script: {
    about: 'the API of a use script',
    text: `export default (k) => {
  k.component('lamp', 'doc', [{ name: 'on', type: 'int', def: 0 }]);   // types: fx int str
  k.system((w) => {                          // every tick, before movement
    for (const id of w.query('lamp', 'pos')) {       // ids, ascending
      const lamp = w.get(id, 'lamp');       // the live object: assign to its fields
    }
  });
  k.system((w) => {}, 'post');               // after triggers
};
WORLD (w)
query(...comps)  match(name or #tag)  ids.get(name)  names[id]      find entities
get(id, comp)  has(id, comp)  add(id, comp, {every field})  drop(id, comp)
spawn(name) -> id   throws if the name is taken: put w.tick or a count in it
despawn(id)
on(action) held now   emit(event, a, b) heard by expect, tally, sound
rand() uint32   tick   hz   gx gy gz   events: {tick, name, a, b}[] so far
VALUES  pos vel box are {x, y, z}; tag is {name}. type fx is fixed-point: 1 unit = k.ONE.
k.fx(1.5), k.mul(a, b), k.div(a, b), k.fmtFx(v) text, k.tickShare(perSecond, w.tick, w.hz)
RULES  no floats, no Math.random or Date; keep state in components, not in variables.
console.log shows in the reply.`,
  },
};

/** One part of the manual. Its component list is generated from the registry. */
export function topicText(topic: string): string {
  const t = TOPICS[topic];
  const comps = schemaText(topic);
  return `KILN GUIDE: ${topic}  (${t.about})
${t.text}
${comps && `
COMPONENTS
${comps}`}`;
}

/** The lines of the core guide that say what else there is to read. */
function topicIndex(): string {
  return Object.entries(TOPICS).flatMap(([name, t]) => {
    const comps = [...registry.values()].filter((c) => c.topic === name).map((c) => c.name).join(' ');
    return comps ? [`${name}: ${comps}  -- ${t.about}`] : [];
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
entity NAME                         then components, indented 2 spaces
  COMPONENT value value name=value  positional or by name; [x=..] below marks optional
prefab NAME                         a component list without pos, used by tiles spawn
use ./file.ts                       load a script (see SCRIPTS)
expect ...                          a check (see EXPECT)
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
expect reach A B by N    A overlaps B at some tick <= N
expect never A B         A never overlaps B
expect gone A by N       A (or all with that #tag) was despawned
expect event NAME by N   a trigger emitted NAME
expect count NAME OP VALUE at N   NAME events emitted by tick N
expect at N A.comp.field OP VALUE  OP: < <= > >= == !=

INPUT  one per line: TICK ACTION down|up   actions: left right up down a b   (ui: TICK NAME tap)

COMMANDS  (CLI: node src/cli.ts CMD SCENE [options]; MCP: tool kiln, argument cmd)
check  parse and validate (a folder: every scene). Says the edition needed: lite runs
       anywhere; [standard] parts need WebGPU (drawing) or megabytes more (physics). --edition lite: more is an error
test   run, evaluate expects; --input FILE; exit 1 if any fails. A folder: every scene
       with its NAME.input, then once per NAME.CASE.input. expect lines in an input
       replace the scene's. --follow: go on into the scene a load: opened, with its NAME.input
run    run without judging; --ticks N
solve  find an input meeting reach/gone/event, keeping never and count X == 0; --out FILE saves it
schema components only
look   picture of the game view from a headless browser, with what is in it;
       --tick N --input FILE --out FILE.png (needs Chrome/Edge)
play   open in a browser (CLI only); what you press is recorded as an input script
Add to test/run: --view (ASCII picture), --top (3D floor plan), --observe
(positions), --events.

OUTPUT
ok ... / fail ...        last line of every command
pass|FAIL file:line EXPECT -- what happened
E CODE file:line message (hint: ...)   all errors at once; fix all, rerun
W CODE file message (hint: ...)   check only: runs, but part of it does nothing

WORKFLOW
1. Write the scene with expects that say what "working" means.
2. check, then solve. If solve fails, it prints the goal still open and a picture of
   the furthest attempt: fix the level there.
3. Save the input with --out and keep test passing as you change things.

SCRIPTS  only when components cannot express the rule: use ./file.ts exporting
(k) => { k.system((w) => { ... }) }. Read \`guide script\` for the API before writing one.
`;
}
