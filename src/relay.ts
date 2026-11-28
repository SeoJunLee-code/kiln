// A relay for network games: it gives each peer that joins a room a player number and
// passes every message on to the others. It never looks at the game: peers simulate it.
//
// WebSocket (RFC 6455) is written out here, as much of it as a browser needs for short
// text messages, so that the engine has no dependency for it.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

/** The longest message taken from a peer: inputs and hashes are far shorter. */
const MOST = 4096;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface Peer { socket: Duplex; player: number }
interface Room { players: number; peers: Peer[]; started: boolean }

function frame(socket: Duplex, opcode: number, data: Buffer): void {
  if (socket.destroyed) return;
  const head = data.length < 126 ? Buffer.from([0x80 | opcode, data.length]) : Buffer.from([0x80 | opcode, 126, data.length >> 8, data.length & 255]);
  socket.write(Buffer.concat([head, data]));
}
const tell = (peer: Peer, message: object): void => frame(peer.socket, 1, Buffer.from(JSON.stringify(message)));

/** Call `text` for each message and `gone` once, when the connection ends or misbehaves. */
function listen(socket: Duplex, first: Buffer, text: (s: string) => void, gone: () => void): void {
  let buffered = first, over = false;
  const end = (): void => {
    if (over) return;
    over = true;
    socket.destroy();
    gone();
  };
  const read = (): void => {
    while (!over && buffered.length >= 2) {
      const opcode = buffered[0] & 15, masked = buffered[1] & 128;
      let length = buffered[1] & 127, at = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        at = 4;
      }
      // A browser's frames are whole, masked and short; anything else ends the connection.
      if (!(buffered[0] & 128) || !masked || length === 127 || length > MOST) return end();
      if (buffered.length < at + 4 + length) return;
      const mask = buffered.subarray(at, at + 4), data = Buffer.from(buffered.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buffered = buffered.subarray(at + 4 + length);
      if (opcode === 1) text(data.toString('utf8'));
      else if (opcode === 9) frame(socket, 10, data);
      else if (opcode !== 10) return end();
    }
  };
  socket.on('data', (d: Buffer) => { buffered = Buffer.concat([buffered, d]); read(); });
  socket.on('error', end);
  socket.on('close', end);
  socket.on('end', end);
  read();
}

/** Serve rooms on `server` at /relay?room=NAME&players=N. Returns a function that drops every peer. */
export function attachRelay(server: Server): () => void {
  const rooms = new Map<string, Room>(), sockets = new Set<Duplex>();
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x'), key = req.headers['sec-websocket-key'];
    const players = Number(url.searchParams.get('players') ?? 2), name = url.searchParams.get('room') ?? '';
    if (url.pathname !== '/relay' || !key || !Number.isInteger(players) || players < 2 || players > 64) return void socket.destroy();
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
    sockets.add(socket);
    let room = rooms.get(name);
    if (!room) rooms.set(name, room = { players, peers: [], started: false });
    const joined = !room.started && room.players === players;
    let player = 1;
    while (room.peers.some((p) => p.player === player)) player++;
    const peer: Peer = { socket, player };
    if (joined) room.peers.push(peer);
    const mine = room;
    listen(socket, head, (s) => {
      if (!joined || !mine.started) return;
      let m: unknown;
      try { m = JSON.parse(s); } catch { return; }
      if (typeof m !== 'object' || m === null) return;
      // The relay says who a message is from, not the sender.
      const { t, k, h } = m as { t?: unknown; k?: unknown; h?: unknown };
      for (const other of mine.peers) if (other !== peer) tell(other, { p: peer.player, t, k, h });
    }, () => {
      sockets.delete(socket);
      if (!joined) return;
      mine.peers = mine.peers.filter((p) => p !== peer);
      // A game that has started cannot go on without one of its players.
      if (mine.started) for (const other of mine.peers) tell(other, { left: peer.player });
      if (!mine.peers.length && rooms.get(name) === mine) rooms.delete(name);
    });
    if (!joined) return tell(peer, { full: true });
    tell(peer, { you: player });
    if (room.peers.length === players) {
      room.started = true;
      for (const p of room.peers) tell(p, { start: true });
    }
  });
  return () => { for (const s of sockets) s.destroy(); };
}

export function relay(port: number, host = '127.0.0.1'): Promise<{ port: number; close: () => void }> {
  const server = createServer((_, res) => { res.writeHead(426); res.end('this is a Kiln relay: connect by WebSocket at /relay'); });
  const drop = attachRelay(server);
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({ port: (server.address() as import('node:net').AddressInfo).port, close: () => { drop(); server.close(); server.closeAllConnections(); } }));
  });
}
