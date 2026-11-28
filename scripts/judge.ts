// Screen judging of the comparison results by a person: one command that starts each game,
// shows the pass checks of its spec one by one and records a verdict per key press.
//
//   node scripts/judge.ts ARCHIVE [--spec H1|H2|H3|gemvault] [--only NAME] [--godot PATH] [--engine DIR]
//   node scripts/judge.ts ARCHIVE --report
//
// Verdicts go to ARCHIVE/judge-results.json. A game is run from a temporary copy, so the
// archived result stays as the agent left it. The terminal text for the judge is Korean.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { findChrome } from '../src/chrome.ts'

export const SPECS = ['H1', 'H2', 'H3', 'gemvault'] as const
export type Spec = (typeof SPECS)[number]
export interface Check { n: number, do: string, see: string }
export interface Target { id: string, spec: Spec, name: string, setup: string, engine: 'kiln' | 'godot', game: string, log: string }
export interface Verdict { verdict: 'pass' | 'fail' | 'skip', note?: string, at: string }
export interface Entry { spec: Spec, setup: string, engineCommit?: string, checks: Record<string, Verdict> }
export type Results = Record<string, Entry>

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GODOT_DEFAULT = 'C:\\Godot\\Godot_v4.7.2-stable_win64.exe'

/** The numbered rows of the check table under the heading `## Checks` or `## Screen pass checks`. */
export function parseChecks(markdown: string): Check[] {
  const checks: Check[] = []
  let inside = false
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) inside = /^## (Screen pass checks|Checks)\s*$/.test(line)
    const row = inside && /^\|\s*(\d+)\s*\|(.*?)\|(.*)\|\s*$/.exec(line)
    if (row) checks.push({ n: Number(row[1]), do: row[2].trim(), see: row[3].trim() })
  }
  return checks
}

/** The checks of one spec. H2 is the fifteen Gem Vault checks, the last one changed, then its own. */
export function checksFor(spec: Spec, docs: string): Check[] {
  const read = (name: string) => parseChecks(readFileSync(join(docs, name), 'utf8'))
  if (spec === 'gemvault') return read('GEMVAULT-CHECKS.md')
  if (spec !== 'H2') return read(`${spec}.md`)
  const base = read('GEMVAULT-CHECKS.md').map((c) => (c.n === 15 ? { ...c, see: '`Level 4` (in H2, check 15 is "win level 3 and see `Level 4`").' } : c))
  return [...base, ...read('H2.md')]
}

const folders = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []

/** Every result under ARCHIVE that is counted: holdout/SPEC/SETUP-N/game and spread/ENGINE+N/game. */
export function scanArchive(archive: string): Target[] {
  const targets: Target[] = []
  const add = (spec: Spec, name: string, setup: string, run: string, log: string) => {
    const game = join(run, 'game')
    if (/not-counted|infra/.test(name) || !existsSync(game)) return
    targets.push({ id: `${spec}/${name}`, spec, name, setup, engine: setup.startsWith('kiln') ? 'kiln' : 'godot', game, log })
  }
  for (const spec of ['H1', 'H2', 'H3'] as const) {
    const dir = join(archive, 'holdout', spec)
    for (const name of folders(dir)) {
      const m = /^(kiln|godot-file|godot-mcp)-\d+/.exec(name)
      if (m) add(spec, name, m[1], join(dir, name), join(dir, `${name}.jsonl`))
    }
  }
  const spread = join(archive, 'spread')
  for (const name of folders(spread)) {
    const m = /^(kiln|godot)\d+/.exec(name)
    if (m) add('gemvault', name, m[1], join(spread, name), join(archive, 'spread-logs', `${name}.jsonl`))
  }
  return targets
}

/** The scene named after `cli.ts play` in a text, if the game folder has it. */
function played(text: string, game: string): string | undefined {
  for (const m of text.matchAll(/cli\.ts\s+play\b[^\n`]*?([\w.-]+\.kiln)/g)) if (existsSync(join(game, m[1]))) return m[1]
}

function lastAnswer(log: string): string {
  if (!existsSync(log)) return ''
  let answer = ''
  for (const line of readFileSync(log, 'utf8').split('\n')) {
    if (!line.includes('"result"')) continue
    try {
      const j = JSON.parse(line)
      if (j.type === 'result' && typeof j.result === 'string') answer = j.result
    } catch { /* a cut line */ }
  }
  return answer
}

/**
 * The scene a Kiln game is started with: the one the agent's last message says (what the specs
 * ask for), then one the game folder's documents say, then level1.kiln, then the only scene.
 * Undefined when none of these settles it; the judge is asked then.
 */
export function firstScene(game: string, log = ''): string | undefined {
  const said = played(lastAnswer(log), game)
  if (said) return said
  const names = readdirSync(game)
  for (const doc of names.filter((f) => f.endsWith('.md'))) {
    const scene = played(readFileSync(join(game, doc), 'utf8'), game)
    if (scene) return scene
  }
  if (names.includes('level1.kiln')) return 'level1.kiln'
  const scenes = names.filter((f) => f.endsWith('.kiln'))
  return scenes.length === 1 ? scenes[0] : undefined
}

export const isJudged = (entry: Entry | undefined, checks: Check[]): boolean =>
  !!entry && checks.every((c) => entry.checks[c.n])

export interface Row { spec: Spec, setup: string, results: number, passed: number, failed: number, open: number }

/** Per spec and setup: passed = every check holds; failed = a check failed; open = neither yet. */
export function tally(targets: Target[], results: Results, checks: (spec: Spec) => Check[]): Row[] {
  const rows = new Map<string, Row>()
  for (const t of targets) {
    const key = `${t.spec} ${t.setup}`
    const row = rows.get(key) ?? { spec: t.spec, setup: t.setup, results: 0, passed: 0, failed: 0, open: 0 }
    rows.set(key, row)
    const verdicts = checks(t.spec).map((c) => results[t.id]?.checks[c.n]?.verdict)
    row.results++
    if (verdicts.includes('fail')) row.failed++
    else if (verdicts.every((v) => v === 'pass')) row.passed++
    else row.open++
  }
  return [...rows.values()]
}

// --- the interactive part ---

/** The same keys with the keyboard left in Korean. */
const HANGUL: Record<string, string> = { ㄹ: 'f', ㄴ: 's', ㅂ: 'q', ㄱ: 'r' }

function terminal() {
  const tty = process.stdin.isTTY
  const rl = createInterface({ input: process.stdin, output: tty ? process.stdout : undefined, terminal: tty })
  const lines: string[] = []
  const waiting: ((line: string | null) => void)[] = []
  let closed = false
  rl.on('line', (l) => (waiting.length ? waiting.shift()!(l) : lines.push(l)))
  rl.on('close', () => { closed = true; for (const w of waiting.splice(0)) w(null) })
  rl.on('SIGINT', () => rl.close())
  const line = (prompt: string) => new Promise<string | null>((done) => {
    process.stdout.write(prompt)
    if (lines.length) done(lines.shift()!)
    else if (closed) done(null)
    else { if (tty) rl.resume(); waiting.push(done) }
  })
  /** One key without Enter on a terminal; the first letter of a line when input is piped. */
  const key = async (prompt: string): Promise<string> => {
    if (!tty) {
      const l = await line(prompt)
      const c = l === null ? 'q' : l.trim().charAt(0).toLowerCase()
      return HANGUL[c] ?? c
    }
    process.stdout.write(prompt)
    rl.pause()
    // readline keeps its own listener on stdin; it is set aside while a single key is read.
    const held = process.stdin.listeners('keypress')
    process.stdin.removeAllListeners('keypress')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const k = await new Promise<string>((done) => process.stdin.once('keypress', (s: string | undefined, info: { name?: string, ctrl?: boolean }) =>
      done(info?.ctrl && info.name === 'c' ? 'q' : info?.name === 'return' || info?.name === 'enter' ? '' : (info?.name ?? s ?? '?'))))
    // Not left flowing: an Enter hit while a game is starting would otherwise become the next memo.
    process.stdin.pause()
    for (const l of held) process.stdin.on('keypress', l as (...args: unknown[]) => void)
    process.stdout.write(`${k || 'Enter'}\n`)
    return HANGUL[k] ?? k
  }
  return { line, key, close: () => rl.close() }
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
}

const exited = (child: ChildProcess) => new Promise<void>((done) => {
  if (child.exitCode !== null || child.signalCode !== null) return done()
  child.once('exit', () => done())
  setTimeout(done, 5000).unref()
})

interface Running { close(): Promise<void> }

/** Starts one game from a copy of its folder and returns how to shut everything down again. */
async function start(t: Target, scene: string | undefined, opts: { godot: string, engine: string }): Promise<Running> {
  const temp = mkdtempSync(join(tmpdir(), 'kiln-judge-'))
  const game = join(temp, 'game')
  const children: ChildProcess[] = []
  const close = async () => {
    for (const c of children) stop(c)
    await Promise.all(children.map(exited))
    try { rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* left in the temp folder */ }
  }
  try {
    cpSync(t.game, game, { recursive: true })
    if (t.engine === 'godot') {
      // A project that was never opened has no imported sounds or pictures.
      spawnSync(opts.godot, ['--headless', '--path', game, '--import'], { stdio: 'ignore', timeout: 120000 })
      const run = spawn(opts.godot, ['--path', game], { stdio: ['ignore', 'inherit', 'inherit'] })
      run.on('error', (e) => console.log(`Godot를 띄우지 못함: ${e.message}`))
      children.push(run)
    } else {
      const server = spawn(process.execPath, [join(opts.engine, 'src', 'cli.ts'), 'play', join(game, scene!), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] })
      children.push(server)
      const url = await new Promise<string>((ok, fail) => {
        let out = ''
        server.stdout!.on('data', (d) => {
          out += d
          const m = /ok play (\S+)/.exec(out)
          if (m) ok(m[1])
        })
        server.on('exit', () => fail(new Error(out.trim() || 'play ended at once')))
        setTimeout(() => fail(new Error(`no address from play: ${out.trim()}`)), 30000).unref()
      })
      const chrome = findChrome()
      if (chrome) {
        const window = spawn(chrome, [`--user-data-dir=${join(temp, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1100,800', `--app=${url}`], { stdio: 'ignore' })
        children.push(window)
      }
      console.log(chrome ? `브라우저 창: ${url}` : `Chrome/Edge를 못 찾음. 직접 여세요: ${url}`)
    }
  } catch (e) {
    await close()
    throw e
  }
  return { close }
}

function load(file: string): Results {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).results : {}
}

function save(file: string, results: Results): void {
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ results }, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

function report(rows: Row[]): void {
  console.log('| spec | setup | results | passed all checks | failed | not settled |\n|---|---|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.spec} | ${r.setup} | ${r.results} | ${r.passed} | ${r.failed} | ${r.open} |`)
}

async function main(args: string[]): Promise<number> {
  const options: Record<string, string> = {}
  const rest: string[] = []
  let wantsReport = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report') wantsReport = true
    else if (['--spec', '--only', '--godot', '--engine'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = args[++i]
    else if (!args[i].startsWith('--')) rest.push(args[i])
    else { console.log(`알 수 없는 옵션: ${args[i]}`); return 2 }
  }
  const spec = SPECS.find((s) => s.toLowerCase() === options.spec?.toLowerCase())
  if (rest.length !== 1 || (options.spec && !spec)) {
    console.log('node scripts/judge.ts ARCHIVE [--spec H1|H2|H3|gemvault] [--only NAME] [--godot PATH] [--engine DIR] [--report]')
    return 2
  }
  const archive = resolve(rest[0])
  const targets = scanArchive(archive).filter((t) => (!spec || t.spec === spec) && (!options.only || t.name === options.only || t.id === options.only))
  if (!targets.length) { console.log(`판정할 결과물이 없음: ${archive}`); return 2 }
  const docs = join(REPO, 'proof', 'compare')
  const file = join(archive, 'judge-results.json')
  const results = load(file)
  const checks = (s: Spec) => checksFor(s, docs)
  if (wantsReport) { report(tally(targets, results, checks)); return 0 }

  const godot = options.godot ?? process.env.GODOT ?? GODOT_DEFAULT
  const engine = resolve(options.engine ?? REPO)
  const commit = spawnSync('git', ['-C', engine, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || undefined
  const todo = targets.filter((t) => !isJudged(results[t.id], checks(t.spec)))
  console.log('녹화: 게임 창을 누르고 Win+Alt+R')
  console.log(`결과물 ${targets.length}개 중 남은 것 ${todo.length}개. 키: Enter 통과 / f 실패 / s 건너뜀 / r 게임 다시 띄우기 / q 저장하고 끝`)
  const term = terminal()
  let running: Running | undefined
  process.on('SIGTERM', () => { void running?.close().then(() => process.exit(1)) })
  try {
    for (const [i, t] of todo.entries()) {
      console.log(`\n=== [${i + 1}/${todo.length}] ${t.id}`)
      if (t.engine === 'godot' && !existsSync(godot)) { console.log(`Godot 실행 파일이 없음: ${godot} (--godot PATH)`); continue }
      let scene: string | undefined
      if (t.engine === 'kiln') {
        scene = firstScene(t.game, t.log)
        if (!scene) {
          console.log(`첫 장면을 못 정함. 장면: ${readdirSync(t.game).filter((f) => f.endsWith('.kiln')).join(' ')}`)
          scene = (await term.line('첫 장면 파일 이름(빈 줄 = 이 결과물 넘김): '))?.trim()
          if (!scene || !existsSync(join(t.game, basename(scene)))) continue
          scene = basename(scene)
        }
        console.log(`첫 장면: ${scene}`)
      }
      const entry = results[t.id] ?? { spec: t.spec, setup: t.setup, checks: {} }
      if (t.engine === 'kiln') entry.engineCommit = commit
      try {
        running = await start(t, scene, { godot, engine })
      } catch (e) {
        console.log(`띄우지 못함: ${(e as Error).message}`)
        if ((await term.key('Enter 다음 결과물 / q 끝: ')) === 'q') return 0
        continue
      }
      const list = checks(t.spec)
      for (const c of list) {
        if (entry.checks[c.n]) continue
        console.log(`\n[${c.n}/${list.length}] 하기: ${c.do}\n        보기: ${c.see}`)
        let k = ''
        for (;;) {
          k = await term.key('Enter/f/s/r/q > ')
          if (k === 'r') {
            await running.close()
            running = await start(t, scene, { godot, engine })
          } else if (['', 'f', 's', 'q'].includes(k)) break
        }
        if (k === 'q') return 0
        const note = k === 'f' ? (await term.line('실패 메모(한 줄): '))?.trim() : undefined
        entry.checks[c.n] = { verdict: k === 'f' ? 'fail' : k === 's' ? 'skip' : 'pass', ...(note ? { note } : {}), at: new Date().toISOString() }
        results[t.id] = entry
        save(file, results)
      }
      await running.close()
      running = undefined
    }
    console.log('\n끝.')
    report(tally(targets, results, checks))
    return 0
  } finally {
    await running?.close()
    term.close()
    console.log(`기록: ${file}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2))
