// Automatic screen judging, first version: pictures of each archived game, the spec's pass
// checks beside them, a judging model's answer per check, and how often that answer agrees
// with a person's. It is a measuring tool for development. The comparison's verdicts stay
// with the person (docs/EDITIONS.md, "Winning, not only matching").
//
//   node scripts/autojudge.ts ARCHIVE --packets OUT [--spec H3] [--only NAME] [--godot PATH]
//       one folder per game under OUT: frames (PNG) and PACKET.md (the checks and what each
//       frame is). Kiln games: every scene at its start and through its own recorded input.
//       Godot games: frames of the game left alone (--write-movie); see "Limits" below.
//   node scripts/autojudge.ts ARCHIVE --judge OUT --with "COMMAND"
//       runs COMMAND once per packet with the packet folder as its last argument; COMMAND
//       prints one JSON object {"1":"pass","2":"fail","3":"unsure",...}. Answers go to
//       ARCHIVE/auto-results.json. The command is the owner's (a headless model call).
//   node scripts/autojudge.ts ARCHIVE --agree
//       auto-results.json against judge-results.json (scripts/judge.ts): per spec, how many
//       checks both judged, how many agree, and which way the disagreements lean per engine.
//
// Limits, known before the first run: nothing here plays a game. A check that needs a level
// to be won, or a key held at the right moment, is answered "unsure" unless the game's own
// input happens to show it; a Godot game is seen only as it starts. So coverage is reported
// beside agreement, and low coverage is a result. The judge sees pictures only, never the
// engine's state. Sound and feel cannot be judged this way at all.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checksFor, scanArchive } from './judge.ts'
import type { Check, Results, Spec, Target } from './judge.ts'

export type Answer = 'pass' | 'fail' | 'unsure'
export type Auto = Record<string, { spec: Spec, setup: string, checks: Record<string, Answer> }>
export interface Frame { file: string, what: string }

/** The ticks a scene is pictured at: its start, then evenly through its input to the end. */
export function ticksFor(lastTick: number, frames = 4): number[] {
  if (lastTick <= 0) return [0]
  const out = new Set<number>([0])
  for (let i = 1; i <= frames; i++) out.add(Math.round((lastTick * i) / frames))
  return [...out].sort((a, b) => a - b)
}

/** The last tick an input script names (0 when it has none). */
export const lastTickOf = (input: string): number =>
  Math.max(0, ...input.split(/\r?\n/).map((l) => /^\s*(\d+)\s+\S+\s+(down|up|tap)\b/.exec(l)).filter(Boolean).map((m) => Number(m![1])))

/** What the judging model is given beside the pictures. */
export function packetText(t: Pick<Target, 'id' | 'spec'>, checks: Check[], frames: Frame[]): string {
  return [
    `# Judge ${t.id} from its pictures`,
    '',
    'You are shown pictures of one game and the checks its spec is judged by. Answer from the',
    'pictures alone. For each check say `pass` only if a picture shows what "See" asks for,',
    '`fail` only if a picture shows the opposite, and `unsure` whenever the pictures do not',
    'show the moment the check is about. Most checks need play that these pictures do not',
    'contain; `unsure` is the expected answer for those. Do not guess from what a game of',
    'this kind usually does.',
    '',
    'Reply with one JSON object and nothing else: {"1":"pass","2":"unsure",...}.',
    '',
    '## Pictures',
    '',
    ...frames.map((f) => `- \`${f.file}\`: ${f.what}`),
    '',
    '## Checks',
    '',
    '| # | Do | See |', '|---|---|---|',
    ...checks.map((c) => `| ${c.n} | ${c.do} | ${c.see} |`),
    '',
  ].join('\n')
}

/** The first JSON object in a judge's output, kept to the checks asked and the three answers. */
export function parseAnswer(text: string, checks: Check[]): Record<string, Answer> {
  const m = /\{[^{}]*\}/.exec(text)
  let raw: Record<string, unknown> = {}
  try { raw = m ? JSON.parse(m[0]) : {} } catch { /* an answer that is not JSON is all unsure */ }
  const out: Record<string, Answer> = {}
  for (const c of checks) out[c.n] = raw[c.n] === 'pass' || raw[c.n] === 'fail' ? (raw[c.n] as Answer) : 'unsure'
  return out
}

export interface Agreement {
  spec: Spec; engine: 'kiln' | 'godot'
  /** checks a person judged pass or fail */
  judged: number
  /** of those, the ones the automatic judge also answered pass or fail */
  covered: number
  agree: number
  /** disagreements where the automatic judge was the kinder one, and the harsher one */
  autoKinder: number; autoHarsher: number
}

/** Automatic answers against a person's, per spec and engine. `skip` and `unsure` are not disagreements: they are no answer. */
export function agreement(targets: Pick<Target, 'id' | 'spec' | 'engine'>[], auto: Auto, human: Results): Agreement[] {
  const rows = new Map<string, Agreement>()
  for (const t of targets) {
    const key = `${t.spec} ${t.engine}`
    let row = rows.get(key)
    if (!row) rows.set(key, row = { spec: t.spec, engine: t.engine, judged: 0, covered: 0, agree: 0, autoKinder: 0, autoHarsher: 0 })
    for (const [n, v] of Object.entries(human[t.id]?.checks ?? {})) {
      if (v.verdict === 'skip') continue
      row.judged++
      const a = auto[t.id]?.checks[n]
      if (a !== 'pass' && a !== 'fail') continue
      row.covered++
      if (a === v.verdict) row.agree++
      else if (a === 'pass') row.autoKinder++
      else row.autoHarsher++
    }
  }
  return [...rows.values()]
}

/** One line per row, and the pre-test's threshold said in words. */
export function agreementReport(rows: Agreement[]): string[] {
  const pct = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : 'n/a')
  const out = rows.map((r) => `${r.spec} ${r.engine}: judged ${r.judged}, covered ${r.covered} (${pct(r.covered, r.judged)}), agree ${r.agree} (${pct(r.agree, r.covered)}), auto kinder ${r.autoKinder}, auto harsher ${r.autoHarsher}`)
  const covered = rows.reduce((n, r) => n + r.covered, 0), agree = rows.reduce((n, r) => n + r.agree, 0)
  out.push(`all: covered ${covered}, agree ${agree} (${pct(agree, covered)}). The plan keeps a person's judging below 90% agreement, or if one engine is favoured.`)
  return out
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Pictures of a Kiln game folder: each scene at its start and along its own input. */
export async function kilnFrames(game: string, out: string, engine = REPO): Promise<Frame[]> {
  const { look } = await import(join(engine, 'src/look.ts')) as typeof import('../src/look.ts')
  const { launch } = await import(join(engine, 'src/chrome.ts')) as typeof import('../src/chrome.ts')
  const { GPU_SWITCHES } = await import(join(engine, 'src/look.ts')) as typeof import('../src/look.ts')
  const browser = await launch({ args: GPU_SWITCHES })
  const frames: Frame[] = []
  try {
    for (const scene of readdirSync(game).filter((f) => f.endsWith('.kiln')).sort()) {
      const input = join(game, scene.replace(/\.kiln$/, '.input')), has = existsSync(input)
      for (const tick of ticksFor(has ? lastTickOf(readFileSync(input, 'utf8')) : 0)) {
        const file = `${scene.replace(/\.kiln$/, '')}@${tick}.png`
        try {
          const seen = await look(join(game, scene), { tick, inputFile: has ? input : undefined, browser })
          writeFileSync(join(out, file), seen.png)
          frames.push({ file, what: `scene \`${scene}\` at tick ${seen.tick}${has ? ', replaying the input its agent saved' : ', untouched'}${seen.errors.length ? `; the page reported: ${seen.errors[0]}` : ''}` })
        } catch (e) {
          frames.push({ file: '(none)', what: `scene \`${scene}\` could not be drawn: ${(e as Error).message.split('\n')[0]}` })
          break
        }
      }
    }
  } finally { await browser.close() }
  return frames
}

/** Pictures of a Godot game left alone for three seconds. Not tried where this was written: there is no Godot there. */
export function godotFrames(game: string, out: string, godot: string): Frame[] {
  const r = spawnSync(godot, ['--path', game, '--fixed-fps', '60', '--quit-after', '180', '--write-movie', join(out, 'godot.png')], { encoding: 'utf8', timeout: 120_000 })
  const made = readdirSync(out).filter((f) => /^godot\d+\.png$/.test(f)).sort()
  const keep = [0, 60, 120, 179].map((i) => made[i]).filter(Boolean)
  if (!keep.length) return [{ file: '(none)', what: `the game made no picture: ${(r.stderr || r.error?.message || '').split('\n')[0]}` }]
  return keep.map((file) => ({ file, what: `the game ${Math.round((Number(/\d+/.exec(file)![0]) / 60) * 10) / 10} s after it started, with no key pressed` }))
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2), flag = (n: string): string | undefined => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
  const archive = argv[0] && !argv[0].startsWith('--') ? resolve(argv[0]) : ''
  if (!archive || !existsSync(archive)) { console.log('E K001 autojudge needs the archive folder (see the head of scripts/autojudge.ts)'); process.exit(2) }
  const docs = join(REPO, 'proof/compare')
  const targets = scanArchive(archive).filter((t) => (!flag('--spec') || t.spec === flag('--spec')) && (!flag('--only') || t.name === flag('--only')))
  const autoFile = join(archive, 'auto-results.json'), load = <T>(f: string): T => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}) as T
  if (argv.includes('--agree')) {
    for (const line of agreementReport(agreement(targets, load<Auto>(autoFile), load<Results>(join(archive, 'judge-results.json'))))) console.log(line)
    return
  }
  const out = resolve(flag('--packets') ?? flag('--judge') ?? '')
  if (argv.includes('--packets')) {
    for (const t of targets) {
      const dir = join(out, t.id.replace('/', '-'))
      mkdirSync(dir, { recursive: true })
      const frames = t.engine === 'kiln' ? await kilnFrames(t.game, dir, flag('--engine') ? resolve(flag('--engine')!) : REPO)
        : flag('--godot') ? godotFrames(t.game, dir, flag('--godot')!) : [{ file: '(none)', what: 'no --godot executable was given' }]
      writeFileSync(join(dir, 'PACKET.md'), packetText(t, checksFor(t.spec, docs), frames))
      console.log(`${t.id} frames=${frames.filter((f) => f.file !== '(none)').length}`)
    }
    return
  }
  if (argv.includes('--judge')) {
    const cmd = flag('--with')
    if (!cmd) { console.log('E K002 --judge needs --with "COMMAND"'); process.exit(2) }
    const auto = load<Auto>(autoFile)
    for (const t of targets) {
      const dir = join(out, t.id.replace('/', '-'))
      if (!existsSync(join(dir, 'PACKET.md'))) continue
      const r = spawnSync(`${cmd} "${dir}"`, { shell: true, encoding: 'utf8', timeout: 600_000 })
      auto[t.id] = { spec: t.spec, setup: t.setup, checks: parseAnswer(r.stdout ?? '', checksFor(t.spec, docs)) }
      writeFileSync(autoFile, JSON.stringify(auto, null, 2) + '\n')
      console.log(`${t.id} ${Object.values(auto[t.id].checks).filter((a) => a !== 'unsure').length} answered`)
    }
    return
  }
  console.log('E K002 give --packets OUT, --judge OUT --with "COMMAND", or --agree')
  process.exit(2)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
