import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { command } from '../src/commands.ts';
import { axes, lowest, needs, why } from '../src/edition.ts';
import { parseScene, schemaText } from '../src/scene.ts';

const root = (p: string): string => new URL(`../${p}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const editionOf = (text: string): string => lowest(needs(parseScene(text)));
const BOX = 'entity a\n  pos 0 0\n  box 1 1\n';

// The edition of every example, written down so that a change in where the line falls is a
// change someone made on purpose. Standard here is exactly: Rapier, glTF, or turning in 3D.
const STANDARD = ['gallery3d', 'orrery3d', 'tumble3d'];

test('edition: each example needs the edition written here', async () => {
  for (const f of readdirSync(root('examples')).filter((x) => x.endsWith('.kiln'))) {
    const r = await command('check', { file: root(`examples/${f}`) });
    const want = STANDARD.includes(f.replace('.kiln', '')) ? 'standard' : 'lite';
    assert.match(r.text, new RegExp(` edition=${want} `), `${f}:\n${r.text}`);
    // A Lite scene says nothing more; any other says why.
    assert.equal(/^(drawing|physics|world|network) /m.test(r.text), want !== 'lite', `${f}:\n${r.text}`);
  }
});

test('edition: what makes a scene Standard, and what does not', () => {
  assert.equal(editionOf(BOX), 'lite');
  assert.equal(editionOf(`${BOX}  rot 30 spin=90\n`), 'lite', 'turning in 2D is Lite');
  assert.equal(editionOf(`${BOX}  eye 0 -8 9\n  sprite mesh=gem.obj\n`), 'lite', '3D with an OBJ mesh is Lite');
  assert.equal(editionOf(`${BOX}  eye 0 -8 9\n  rot 30\n`), 'standard', 'WebGL2 does not turn boxes in 3D');
  assert.equal(editionOf(`${BOX}  quat 0 0 0 1\n`), 'standard');
  assert.equal(editionOf(`${BOX}  sprite mesh=crate.glb\n`), 'standard');
  assert.equal(editionOf(`${BOX}  sprite mesh=totem.GLTF\n`), 'standard');
  assert.equal(editionOf(`world physics=rapier\n${BOX}`), 'standard');
  for (const c of ['rigid', 'impulse 1 0 0', 'force 1 0 0']) assert.equal(editionOf(`${BOX}  ${c}\n`), 'standard', c);
});

test('edition: check says why, with the line of each kind of use', async () => {
  const scene = `world physics=rapier\n${BOX}  rigid\nentity b\n  pos 3 0\n  box 1 1\n  rigid shape=ball\n  sprite mesh=crate.glb\nexpect at 1 a.pos.x == 0\n`;
  const r = await command('check', { scene });
  if (/^E K130 /m.test(r.text)) return; // the backend is optional on a developer's machine; CI installs it
  assert.equal(r.code, 0, r.text);
  // One line per axis above Lite, in the order of the axes; an axis at Lite is not mentioned.
  assert.deepEqual(r.text.trimEnd().split('\n'), [
    'drawing standard: a glTF mesh (line 10)',
    `physics standard: physics=rapier (line 1), 'rigid' (line 5, +1 more)`,
    'ok entities=2 expects=1 scripts=0 edition=standard warnings=0',
  ]);
});

test('edition: the axes are separate, so a game can be Lite in drawing and Standard in physics', () => {
  const list = needs(parseScene(`${BOX}  rigid\n  rot 30\n`));
  assert.deepEqual(axes(list), { drawing: 'lite', physics: 'standard', world: 'lite', network: 'lite' });
  assert.deepEqual(why(list), [`physics standard: 'rigid' (line 4)`]);
  assert.deepEqual(axes(needs(parseScene(`${BOX}  quat 0 0 0 1\n`))), { drawing: 'standard', physics: 'lite', world: 'lite', network: 'lite' });
  assert.deepEqual(axes([]), { drawing: 'lite', physics: 'lite', world: 'lite', network: 'lite' });
});

test('edition: a use above the ceiling is an error with its line; at or under it, nothing changes', async () => {
  const scene = `${BOX}  quat 0 0 0 1\nentity b\n  pos 3 0\n  box 1 1\n  quat 0 0 0 1\n  sprite mesh=crate.glb\nexpect at 1 a.pos.x == 0\n`;
  const lite = await command('check', { scene, edition: 'lite' });
  assert.equal(lite.code, 2);
  assert.deepEqual(lite.text.trimEnd().split('\n'), [
    `E K140 scene:4 'quat' needs drawing standard; the ceiling is lite`,
    `E K140 scene:8 'quat' needs drawing standard; the ceiling is lite`,
    `E K140 scene:9 a glTF mesh needs drawing standard; the ceiling is lite`,
    'fail errors=3',
  ]);
  const open = await command('check', { scene });
  for (const edition of ['standard', 'ultra']) assert.equal((await command('check', { scene, edition })).text, open.text);
  assert.equal((await command('check', { scene: `${BOX}expect at 1 a.pos.x == 0\n`, edition: 'lite' })).code, 0);
  const bad = await command('check', { scene, edition: 'max' });
  assert.equal(bad.code, 2);
  assert.match(bad.text, /^E K002 edition must be one of: lite standard ultra$/m);
});

test('edition: an entity spawned from a prefab points at the prefab line', async () => {
  const scene = 'prefab ball\n  box 1 1\n  quat 0 0 0 1\nentity map\n  pos 0 0\n  tiles spawn=o:ball\n    o.o\n';
  const r = await command('check', { scene, edition: 'lite' });
  assert.match(r.text, /^E K140 scene:3 'quat' needs drawing standard/m);
  assert.match(r.text, /^fail errors=2$/m);
});

test('edition: a folder is a game, and needs the largest edition of its scenes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-edition-'));
  writeFileSync(join(dir, 'one.kiln'), `${BOX}expect at 1 a.pos.x == 0\n`);
  writeFileSync(join(dir, 'two.kiln'), `${BOX}  quat 0 0 0 1\nexpect at 1 a.pos.x == 0\n`);
  const r = await command('check', { file: dir });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.text.trimEnd().split('\n'), [
    'one.kiln ok entities=1 expects=1 scripts=0 edition=lite warnings=0',
    `two.kiln drawing standard: 'quat' (line 4)`,
    'two.kiln ok entities=1 expects=1 scripts=0 edition=standard warnings=0',
    'ok scenes=2 passed=2 failed=0 edition=standard',
  ]);
  const capped = await command('check', { file: dir, edition: 'lite' });
  assert.equal(capped.code, 2);
  assert.match(capped.text, /^two\.kiln E K140 .*two\.kiln:4 'quat' needs drawing standard; the ceiling is lite$/m);
  assert.match(capped.text, /^fail scenes=2 passed=1 failed=1$/m);
});

test('edition: the component reference marks what is not Lite', () => {
  const marked = schemaText().split('\n').filter((l) => l.includes('[standard]')).map((l) => l.split(' ')[0]);
  assert.deepEqual(marked.sort(), ['force', 'impulse', 'quat', 'rigid']);
});

// Rule 6 of docs/EDITIONS.md: a Lite feature is drawn by both renderers. The picture check
// keeps a WebGPU-only reference ('own') for the scenes WebGL2 cannot draw, so those and
// the scenes that are Standard in drawing must be the same set.
test('edition: the scenes only WebGPU draws are exactly the ones whose drawing is Standard', async () => {
  const cases = [...readFileSync(root('scripts/images.ts'), 'utf8').matchAll(/\['(\w+)', \d+(?:, '(\w+)'(?:, '(own)')?)?\]/g)];
  assert.ok(cases.length >= 15, 'the list of pictures was not found');
  const own = new Set(cases.filter((c) => c[3]).map((c) => c[1]));
  assert.ok(own.size > 0);
  for (const name of new Set(cases.map((c) => c[1]))) {
    const r = await command('check', { file: root(`examples/${name}.kiln`) });
    assert.equal(/^drawing standard: /m.test(r.text), own.has(name), `${name}:\n${r.text}`);
  }
});

// Rule 4: a game ships only what it uses. Rule 5: the engine's bytes in a built game stay
// under a budget. The numbers were set from the first measurement (2026-11-26: 90,703 /
// 128,480 / 4,537,594) with about 3% of room, and tightened on 2026-11-27 when `build`
// began to squeeze engine files (measured 61,108 / 90,484 / 4,491,655). The 2D number
// keeps about 11,000 bytes for the Lite rows still to come (animation, gamepad, audio,
// UI); raise one only on purpose, in the same change that says what the bytes bought.
const BUDGET = { lite2d: 72_000, lite3d: 102_000, standard: 4_630_000 };

test('squeeze: comments, indentation and blank lines go; strings, templates and regular expressions stay', async () => {
  const { squeeze } = await import('../src/squeeze.ts');
  const { stripTypeScriptTypes } = await import('node:module');
  const { execFileSync } = await import('node:child_process');
  const src = [
    '/** doc */',
    'const a = 1;   // note',
    '',
    '  const s = "  // not a comment  ",  t = \'/* nor   this */\';',
    '  const re = /[/"]  \\/ `/g, q = a / 2 / 1;',
    '  const w = `line',
    '    // kept   ${ a  +  /* gone */ `in ${ { b: 1 }.b }  ner` }',
    '  end`;',
    '  if (a) { /* x */ b() }',
  ].join('\n');
  assert.equal(squeeze(src), [
    'const a = 1;',
    'const s = "  // not a comment  ", t = \'/* nor   this */\';',
    'const re = /[/"]  \\/ `/g, q = a / 2 / 1;',
    'const w = `line',
    '    // kept   ${ a + `in ${ { b: 1 }.b }  ner` }',
    '  end`;',
    'if (a) { b() }',
    '',
  ].join('\n'));
  assert.equal(squeeze(squeeze(src)), squeeze(src));

  // Every module of the engine still parses after squeezing. That it still behaves the
  // same is held by the browser tests, which run built games against headless hashes.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-squeeze-'));
  const files = [...readdirSync(root('src')).map((f) => `src/${f}`), ...readdirSync(root('web')).map((f) => `web/${f}`), 'backends/rapier/index.ts'].filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const js = stripTypeScriptTypes(readFileSync(root(f), 'utf8'));
    const out = squeeze(js);
    assert.ok(out.length < js.length, f);
    assert.ok(!/^\s|[ \t]$|\n\n/m.test(out.replace(/`[^`]*`/g, '``')) , `${f}: a blank line or an indented line outside a template is left`);
    writeFileSync(join(dir, `${f.replace(/\W/g, '_')}.mjs`), out);
  }
  for (const f of readdirSync(dir)) execFileSync(process.execPath, ['--check', join(dir, f)], { stdio: 'pipe' });
});

test('edition: a built game carries only the parts it uses, within the byte budget', async () => {
  const { build } = await import('../src/build.ts');
  const { copyFileSync, existsSync } = await import('node:fs');
  const game = (files: string[], extra: Record<string, string> = {}): string => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-game-'));
    for (const f of files) copyFileSync(root(`examples/${f}`), join(dir, f));
    for (const [f, text] of Object.entries(extra)) writeFileSync(join(dir, f), text);
    return dir;
  };
  const built = (dir: string, scene: string) => {
    const out = mkdtempSync(join(tmpdir(), 'kiln-out-'));
    const b = build(join(dir, scene), out);
    const sum = b.written.filter((f) => f.startsWith('engine/')).reduce((n, f) => n + readFileSync(join(out, f)).length, 0);
    assert.equal(b.engineBytes, sum, 'the reported size is the size on disk');
    return { ...b, web: b.written.filter((f) => f.startsWith('engine/web/')).map((f) => f.slice(11)).sort(), out };
  };

  const flat = built(game(['maze.kiln', 'platformer.kiln', 'hero.svg']), 'maze.kiln');
  assert.deepEqual([flat.parts, flat.web], [[], ['player.js']]);
  assert.ok(flat.engineBytes <= BUDGET.lite2d, `2D Lite engine is ${flat.engineBytes} bytes, budget ${BUDGET.lite2d}`);
  // The player asks for its parts by the names a static host will have. inspect.js is the panel
  // of `play`: named here, never written into a build and never asked for by a built game.
  const player = readFileSync(join(flat.out, 'engine/web/player.js'), 'utf8');
  assert.deepEqual([...player.matchAll(/import\('(\.[^']+)'\)/g)].map((m) => m[1]).sort(), ['./audio.js', './gl.js', './gltf.js', './gpu.js', './inspect.js']);

  const solid = built(game(['arena3d.kiln', 'gem.obj']), 'arena3d.kiln');
  assert.deepEqual([solid.parts, solid.web], [['3d'], ['gl.js', 'gpu.js', 'mesh.js', 'player.js']]);
  assert.ok(solid.engineBytes <= BUDGET.lite3d, `3D Lite engine is ${solid.engineBytes} bytes, budget ${BUDGET.lite3d}`);

  // Samples and music are a part too: a scene with `sound` brings it, and its files go along.
  const loud = built(game(['level1.kiln', 'level2.kiln', 'coin.wav', 'door.wav', 'tune.wav']), 'level1.kiln');
  assert.deepEqual([loud.parts, loud.web], [['audio'], ['audio.js', 'player.js']]);
  assert.ok(loud.written.includes('game/tune.wav'));
  assert.ok(loud.engineBytes - flat.engineBytes < 1500, `the audio part is ${loud.engineBytes - flat.engineBytes} bytes`);

  // A script can add `eye` while the game runs, so naming it in a script is enough; a model file is enough for the reader.
  const scripted = built(game(['maze.kiln', 'crate.glb'], { 'cam.ts': `export default (k) => k.system('post', (w) => w.add(0, 'eye', { x: 0, y: 0, z: 0, fov: 55 }));\n` }), 'maze.kiln');
  assert.deepEqual([scripted.parts, scripted.web], [['3d', 'gltf'], ['gl.js', 'gltf.js', 'gpu.js', 'mesh.js', 'player.js']]);
  assert.ok(!scripted.written.some((f) => f.startsWith('engine/backends/')));

  if (!existsSync(root('backends/rapier/node_modules'))) return; // the optional backend is not installed
  const all = built(root('examples'), 'tumble3d.kiln');
  assert.deepEqual(all.parts, ['3d', 'audio', 'gltf', 'rapier']);
  assert.ok(all.engineBytes <= BUDGET.standard, `Standard engine is ${all.engineBytes} bytes, budget ${BUDGET.standard}`);
});
