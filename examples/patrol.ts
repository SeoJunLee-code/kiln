import type { Kiln } from '../src/load.ts';

// A script adds its own components and systems. It gets everything through `k`
// and must stay deterministic: fixed-point values, w.rand(), w.tick.
export default (k: Kiln): void => {
  k.component('patrol', 'walks back and forth between x=min and x=max', [
    { name: 'min', type: 'fx' },
    { name: 'max', type: 'fx' },
    { name: 'speed', type: 'fx' },
  ]);

  k.system((w) => {
    for (const id of w.query('patrol', 'pos', 'vel')) {
      const p = w.get(id, 'patrol')!, pos = w.get(id, 'pos')!, v = w.get(id, 'vel')!;
      if (pos.x >= p.max) v.x = -(p.speed as number);
      else if (pos.x <= p.min || v.x === 0) v.x = p.speed;
    }
  });
};
