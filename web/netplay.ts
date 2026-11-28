// The player's side of a network game: joins a room on a relay and lets a Session
// (src/net.ts) drive the ticks. Fetched only when the page is opened with ?net.
import { Session, maskOf } from '../src/net.ts';
import type { World } from '../src/world.ts';

export interface Net {
  /** Run one tick if the game has started and the others are close enough; false otherwise. */
  step(): boolean;
  /** One line for the panel. */
  status(): string;
  session(): Session | null;
}

/** `at` is the relay's address ('' for the server this page came from). */
export function join(at: string, room: string, players: number, world: () => World, held: Set<string>): Net {
  const url = new URL(at || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`);
  url.searchParams.set('room', room);
  url.searchParams.set('players', String(players));
  const socket = new WebSocket(url);
  let session: Session | null = null, me = 0, told = 'connecting';
  const send = (m: object | null): void => { if (m) socket.send(JSON.stringify(m)); };
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data as string);
    if (m.you) { me = m.you; told = `player ${me} of ${players}, waiting for the others`; }
    else if (m.start) { session = new Session(world(), { player: me, players }); told = `player ${me} of ${players}`; }
    else if (m.left) { told = `player ${m.left} left; the game is over`; session = null; }
    else if (m.full) told = 'the room is full';
    else session?.receive(m);
  };
  socket.onclose = () => { if (session) told = 'the connection was lost'; session = null; };
  return {
    step() {
      if (!session) return false;
      send(session.local(maskOf(held)));
      const ran = session.advance();
      send(session.check());
      return ran;
    },
    status: () => (session?.desync != null ? `${told}; OUT OF SYNC since tick ${session.desync}` : told),
    session: () => session,
  };
}
