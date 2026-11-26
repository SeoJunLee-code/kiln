import { schemaText } from './scene.ts';

/**
 * The whole manual, sized to be read by an agent in one call. The component list is
 * generated from the registry, so it cannot drift from the code. A test keeps it short.
 */
export function guideText(): string {
  return `KILN GUIDE
A scene is a text file. Run it headless; same scene + same input = same result.

SCENE
world hz=60 gravity=X,Y[,Z] [seed=N]     once, optional
entity NAME                              then components, indented 2 spaces
  COMPONENT value value name=value       positional or by name; [x=..] below marks optional
prefab NAME                              a component list without pos, used by tiles spawn
use ./file.ts                            load a script (see SCRIPTS)
expect ...                               a check (see EXPECT)
# comment
Units: 1 = one cell. y grows DOWN (above the floor = smaller y). z is depth, 3D only.

COMPONENTS
${schemaText().trimEnd()}

TILES  rows follow the tiles line, indented 4 spaces, one character per cell, '.' = empty
entity map
  pos 0 0
  tiles spawn=@:hero,o:coin
    #####
    #@.o#
    #####
A spawned prefab used once keeps its name (hero); used several times it is numbered
(coin1, coin2). Give those a tag and refer to them as #tag.

EXPECT  A and B are entity names or #tags; N is a tick
expect reach A B by N        A overlaps B at some tick <= N
expect never A B             A never overlaps B
expect gone A by N           A (or every entity with that #tag) was despawned
expect event NAME by N       a trigger emitted NAME
expect count NAME OP VALUE at N       how many NAME events were emitted by tick N
expect at N A.comp.field OP VALUE     OP: < <= > >= == !=

INPUT  one per line: TICK ACTION down|up     actions: left right up down a b

COMMANDS  (CLI: node src/cli.ts CMD SCENE [options]; MCP: tool kiln, argument cmd)
check    parse and validate
test     run, evaluate expects; --input FILE; exit 1 if any fails. Given a folder,
         tests every scene in it with the NAME.input next to it
run      run without judging; --ticks N
solve    search for an input that meets reach/gone/event expects; --out FILE saves it
schema   component list only
play     open in a browser (CLI only); what you press is recorded as an input script
Add to test/run: --view (ASCII picture), --top (3D floor plan), --observe (entity
positions), --events.

OUTPUT
ok ... / fail ...                        last line of every command
pass|FAIL file:line EXPECT -- what happened
E CODE file:line message (hint: ...)     all errors at once; fix them all, then rerun
W CODE file message (hint: ...)          check only: it runs, but part of it does nothing

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
