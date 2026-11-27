// Samples and music: the part of the player that a scene with a `sound` component asks
// for. Nothing here touches the simulation; a game without `sound` ships without this file.
import { ONE } from '../src/fx.ts';

export interface Sounds {
  /** Play the sample listed for this event, if there is one. */
  play(event: string): void;
  mute(off: boolean): void;
  /** Files started so far, in order (for checks). */
  played: string[];
  /** Settles when every file has arrived (or failed) and the music has started. */
  ready: Promise<void>;
}

/** `c` is the sound component. Works on any context, also one that renders to a buffer. */
export function makeSounds(ctx: BaseAudioContext, base: URL, c: Record<string, number | string>): Sounds {
  const out = ctx.createGain(), sfx = ctx.createGain(), mus = ctx.createGain();
  sfx.gain.value = (c.vol as number) / ONE;
  mus.gain.value = (c.mvol as number) / ONE;
  sfx.connect(out);
  mus.connect(out);
  out.connect(ctx.destination);
  const buffers = new Map<string, AudioBuffer>(), played: string[] = [];
  const load = async (file: string): Promise<void> => {
    try {
      const r = await fetch(new URL(file, base));
      if (!r.ok) throw new Error(`${r.status}`);
      buffers.set(file, await ctx.decodeAudioData(await r.arrayBuffer()));
    } catch (e) {
      // Reported, so a check sees it; the event is then silent.
      console.error(`sound ${file}: ${(e as Error).message}`);
    }
  };
  const start = (file: string, to: AudioNode, loop = false): void => {
    const buffer = buffers.get(file);
    if (!buffer) return;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.connect(to);
    s.start();
    played.push(file);
  };
  const map = new Map((c.on as string).split(',').filter(Boolean).map((e) => e.split(':') as [string, string]));
  const music = c.music as string;
  const ready = Promise.all([...new Set(map.values()), ...(music ? [music] : [])].map(load)).then(() => { if (music) start(music, mus, true); });
  return {
    play: (event) => { const file = map.get(event); if (file) start(file, sfx); },
    mute: (off) => { out.gain.value = off ? 0 : 1; },
    played,
    ready,
  };
}
