// The program inside a desktop executable (`kiln desktop`). It holds a built game, serves
// it to this machine only, and opens it in a window of the installed Chrome or Edge, which
// draws it; closing the window ends the program. Without a Chromium browser it opens the
// default browser and serves until it is stopped.
// Run outside an executable as `node launcher.cjs DIR`, DIR holding the same files.
'use strict';
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { createServer, get } = require('node:http');
const { homedir } = require('node:os');
const { join } = require('node:path');
const sea = require('node:sea');

const args = process.argv.slice(2);
const dir = sea.isSea() ? undefined : args.shift();
const asset = (name) => (dir === undefined ? Buffer.from(sea.getRawAsset(name)) : readFileSync(join(dir, name)));
const info = JSON.parse(asset('kiln-desktop.json').toString('utf8'));
const files = new Set([...info.files, 'kiln-desktop.json']);

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', wasm: 'application/wasm', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', wav: 'audio/wav', mp3: 'audio/mpeg',
  ogg: 'audio/ogg', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
};

const server = createServer((req, res) => {
  // Only this machine, asking for this server by its own address: a web page elsewhere
  // that points a name of its own at 127.0.0.1 gets nothing.
  const port = server.address().port;
  const host = req.headers.host;
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1) || 'index.html'; } catch { name = ''; }
  if ((host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) || req.method !== 'GET' || !files.has(name)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(asset(name));
});

const listen = (port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
});

const fetchBytes = (url) => new Promise((resolve, reject) => {
  get(url, (res) => {
    const parts = [];
    res.on('data', (d) => parts.push(d));
    res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(parts)) : reject(new Error(`${res.statusCode} ${url}`))));
  }).on('error', reject);
});

/** Is the program on this port this same game, already running? */
const same = async (port) => {
  try { return JSON.parse((await fetchBytes(`http://127.0.0.1:${port}/kiln-desktop.json`)).toString('utf8')).title === info.title; } catch { return false; }
};

function browser() {
  const named = process.env.KILN_BROWSER;
  if (named !== undefined) return existsSync(named) ? named : undefined;
  const env = process.env;
  const known = {
    win32: [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
      .flatMap((root) => [join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe')]),
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
  };
  return (known[process.platform] ?? []).find((p) => existsSync(p));
}

/** Where this game's window keeps what the game saves in the browser. */
function profile() {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA ?? homedir()
    : process.platform === 'darwin' ? join(homedir(), 'Library/Application Support')
      : process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share');
  const at = join(base, 'kiln-games', info.title);
  mkdirSync(at, { recursive: true });
  return at;
}

async function selftest() {
  const port = await listen(0);
  for (const name of files) {
    const got = await fetchBytes(`http://127.0.0.1:${port}/${name.split('/').map(encodeURIComponent).join('/')}`);
    if (!got.equals(asset(name))) throw new Error(`served '${name}' differs`);
  }
  console.log(`ok selftest title=${info.title} files=${files.size} browser=${browser() ? 'found' : 'none'}`);
  server.close();
}

async function main() {
  if (args[0] === '--selftest') return selftest();
  // The same port every time, so what the game keeps in the browser is found again.
  let port;
  try { port = await listen(info.port); } catch {
    if (await same(info.port)) { console.log(`${info.title} is already running`); return; }
    port = await listen(0);
  }
  const url = `http://127.0.0.1:${port}/`;
  const found = browser();
  if (args[0] === '--serve' || !found) {
    console.log(`${info.title}: ${url} (stop with Ctrl+C)`);
    if (args[0] === '--serve') return;
    const open = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(open[0], open[1], { stdio: 'ignore' }).on('error', () => {});
    return;
  }
  const child = spawn(found, [`--app=${url}`, `--user-data-dir=${profile()}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', `--window-size=${info.width},${info.height}`, ...args], { stdio: 'ignore' });
  child.on('error', (e) => { console.error(e.message); process.exit(1); });
  child.on('exit', () => process.exit(0));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
