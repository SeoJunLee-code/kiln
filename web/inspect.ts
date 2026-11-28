// What the person who supervises an agent needs on the page `kiln play` serves: step through
// the run one tick at a time, back as well as forward, and look into any entity. A built game
// never fetches this file and does not carry it.
import { compLine } from '../src/scene.ts';
import { registry } from '../src/world.ts';
import type { World } from '../src/world.ts';

export interface Inspected {
  world: () => World;
  /** go to a tick, paused */
  seek: (tick: number) => void;
  /** where an entity is drawn in the 2D view: left, top, width, height */
  rect: (id: number) => number[];
  canvas: HTMLCanvasElement;
}

/** An entity as scene text: the same lines a scene file would hold. */
export function entityText(w: World, id: number): string[] {
  const out: string[] = [];
  for (const def of registry.values()) {
    const c = w.get(id, def.name);
    if (!c) continue;
    out.push(compLine(def, c).trim());
    if (def.name === 'tiles') out.push(...(c.rows as string).split('\n').map((r) => `  ${r}`));
  }
  return out;
}

/** Adds the panel to the page and returns what the player calls after each draw. */
export function inspect(of: Inspected): () => void {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  };
  const go = (by: number): void => of.seek(Math.max(0, of.world().tick + by));
  const at = make('input', { id: 'goto', type: 'number', min: '0', placeholder: 'tick' });
  at.setAttribute('aria-label', 'Go to tick');
  at.style.cssText = 'width:7em;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:3px 6px';
  at.onchange = () => { if (/^\d+$/.test(at.value)) of.seek(+at.value); at.blur(); };
  const step = (label: string, by: number): HTMLButtonElement => make('button', { type: 'button', onclick: () => go(by) }, label);
  const pick = make('select', { id: 'entity' });
  pick.setAttribute('aria-label', 'Entity to look into');
  const body = make('pre', { id: 'inside' });
  const section = make('div', { id: 'inspect' },
    make('h2', {}, 'Step through'),
    make('div', { className: 'row' }, step('-10', -10), step('-1', -1), step('+1', 1), step('+10', 10), at),
    make('pre', { className: 'open' }, ', .  one tick    < >  ten ticks'),
    make('h2', {}, 'Look into'), pick, body);
  document.querySelector('aside h2:nth-of-type(2)')!.before(section);

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const by = ({ ',': -1, '.': 1, '<': -10, '>': 10 } as Record<string, number>)[e.key];
    if (by) go(by);
  });

  // The entity looked into, by name, so that it is still found after a rewind.
  let chosen = '';
  // Its lines at the last tick shown, to mark what the step changed.
  let shown = { tick: -1, name: '', lines: [] as string[], changed: new Set<string>() };
  let listed = '';
  pick.onchange = () => { chosen = pick.value; pick.blur(); draw(); };
  // A click in the 2D view takes the topmost entity there; clicking again goes to the one below.
  of.canvas.addEventListener('pointerdown', (e) => {
    const w = of.world();
    const hit = w.query('box').filter((id) => {
      if (!w.has(id, 'pos') && !w.has(id, 'pin')) return false;
      const [x, y, wd, h] = of.rect(id);
      return e.offsetX >= x && e.offsetX < x + wd && e.offsetY >= y && e.offsetY < y + h;
    }).map((id) => w.names[id]!).reverse();
    if (!hit.length) return;
    chosen = hit[(hit.indexOf(chosen) + 1) % hit.length];
    draw();
  });

  const draw = (): void => {
    const w = of.world();
    const names = w.names.filter((n) => n != null) as string[];
    if (listed !== names.join()) {
      listed = names.join();
      pick.replaceChildren(new Option('(click the view, or choose)', ''), ...names.map((n) => new Option(n)));
    }
    if (pick.value !== chosen && document.activeElement !== pick) pick.value = chosen;
    const id = w.ids.get(chosen);
    if (id === undefined) {
      body.textContent = chosen ? `${chosen} is not in the world at tick ${w.tick}` : '';
      return;
    }
    const lines = entityText(w, id);
    if (shown.tick !== w.tick || shown.name !== chosen) {
      const before = new Set(shown.name === chosen ? shown.lines : lines);
      shown = { tick: w.tick, name: chosen, lines, changed: new Set(lines.filter((l) => !before.has(l))) };
    }
    body.replaceChildren(...lines.map((l) => make('div', { className: shown.changed.has(l) ? 'pass' : '' }, l)));
    if (!of.canvas.hidden && w.has(id, 'box') && (w.has(id, 'pos') || w.has(id, 'pin'))) {
      const g = of.canvas.getContext('2d')!, [x, y, wd, h] = of.rect(id);
      g.strokeStyle = '#6cc48a';
      g.lineWidth = 2;
      g.strokeRect(x - 1, y - 1, wd + 2, h + 2);
    }
  };
  return draw;
}
