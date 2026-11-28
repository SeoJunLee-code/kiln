// The 3D view of the player: what a scene with an `eye` is drawn from, and the renderer,
// model reader and mesh files that takes. It is a part of its own so that a 2D game
// carries none of it.
import type { Model } from './gltf.ts';
import type { Box3, Lamp, Renderer3 } from './mesh.ts';
import { ONE } from '../src/fx.ts';
import { paintOf } from '../src/scene.ts';
import { tileRows } from '../src/sim.ts';
import type { World } from '../src/world.ts';

export interface View3 {
  name: string;
  draw(world: World, eyeId: number): void;
  read: Renderer3['read'];
}

/**
 * Resolves to null when the browser has neither renderer. Files a frame asks for are added
 * to `loading` while they are on their way; `part` imports a module and reports one the
 * build does not have.
 */
export async function makeView3(canvas3: HTMLCanvasElement, game: URL, loading: Promise<unknown>[], part: <T>(module: Promise<T>) => Promise<T | null>): Promise<View3 | null> {
  const query = new URLSearchParams(location.search), only = query.get('renderer');
  let made: Renderer3 | null = null;
  // ?offscreen: WebGPU frames are made for pictures only and never shown (see look).
  const gpu = only !== 'webgl2' ? await part(import('./gpu.ts')) : null;
  if (gpu) made = await gpu.makeRendererGpu(canvas3, query.has('offscreen')).catch(() => null);
  const gl = !made && only !== 'webgpu' ? await part(import('./gl.ts')) : null;
  if (gl) made = gl.makeRenderer3(canvas3);
  if (!made) return null;
  const renderer = made;

  // Mesh files asked for so far. Each is fetched once and handed to the renderer when it
  // arrives; until then (or if it fails) the entity is drawn as its box.
  const meshAsked = new Set<string>();
  const isModel = (path: string): boolean => /\.(gltf|glb)$/i.test(path);
  const bytesOf = async (url: URL): Promise<Uint8Array> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  // glTF models are drawn only by a renderer with addModel; elsewhere the box shows.
  const loadModel = async (path: string): Promise<void> => {
    try {
      const at = new URL(path, game), reader = await part(import('./gltf.ts'));
      if (!reader) return;
      const model: Model = await reader.loadGltf(await bytesOf(at), (uri) => bytesOf(new URL(uri, at)));
      for (const w of model.warnings) console.warn(`${path}: ${w}`);
      await renderer.addModel?.(path, model);
    } catch (e) {
      // Reported, so a check sees it; the entity is drawn as its box.
      console.error(`mesh ${path}: ${(e as Error).message}`);
    }
  };
  const wantMesh = (path: string): string => {
    if (!meshAsked.has(path)) {
      meshAsked.add(path);
      if (isModel(path)) loading.push(loadModel(path));
      else loading.push(fetch(new URL(path, game)).then((r) => (r.ok ? r.text() : '')).then((t) => { if (t) renderer.addMesh(path, t); }).catch(() => {}));
    }
    return path;
  };

  // CSS color name -> rgb 0..1, resolved by the browser and cached.
  const rgbCache = new Map<string, number[]>();
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (css: string): number[] => {
    let c = rgbCache.get(css);
    if (!c) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#d7dbe2';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      rgbCache.set(css, (c = [d[0] / 255, d[1] / 255, d[2] / 255]));
    }
    return c;
  };

  const draw = (world: World, eyeId: number): void => {
    const boxes: Box3[] = [];
    const u = (n: number | string): number => (n as number) / ONE;
    for (const m of world.query('tiles', 'pos')) {
      const t = world.get(m, 'tiles')!, p = world.get(m, 'pos')!, size = u(t.size);
      tileRows(t).forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '.') continue;
          const flat = t.plane === 'xz';
          boxes.push({
            p: flat ? [u(p.x) + c * size, u(p.y), u(p.z) + r * size] : [u(p.x) + c * size, u(p.y) + r * size, u(p.z)],
            s: flat ? [size, u(t.depth), size] : [size, size, u(t.depth)],
            // A painted color shows in 3D too; a painted image is for the 2D view only.
            color: rgb(paintOf(t.paint as string).get(row[c])?.[0] || ((t.solid as string).includes(row[c]) ? '#59616e' : '#7a8494')),
          });
        }
      });
    }
    for (const id of world.query('pos', 'box')) {
      const p = world.get(id, 'pos')!, b = world.get(id, 'box')!, sp = world.get(id, 'sprite'), color = (sp?.color as string) ?? 'white';
      const qt = world.get(id, 'quat'), r = world.get(id, 'rot');
      let q: number[] | undefined;
      if (qt) q = [u(qt.x), u(qt.y), u(qt.z), u(qt.w)];
      else if (r) {
        const half = (u(r.angle) * Math.PI) / 360, s = Math.sin(half);
        q = [r.axis === 'x' ? s : 0, r.axis === 'y' ? s : 0, r.axis === 'z' ? s : 0, Math.cos(half)];
      }
      boxes.push({
        clip: world.get(id, 'clip'), tick: world.tick, hz: world.hz,
        q,
        p: [u(p.x), u(p.y), u(p.z)], s: [u(b.w), u(b.h), u(b.d)],
        // A model keeps its own colors unless the sprite names one, which then tints it.
        color: color === 'white' && sp?.mesh && isModel(sp.mesh as string) && renderer.addModel ? [1, 1, 1] : rgb(color === 'white' ? (world.has(id, 'solid') ? '#59616e' : '#d7dbe2') : color),
        mesh: sp?.mesh ? wantMesh(sp.mesh as string) : undefined,
      });
    }
    const e = world.get(eyeId, 'eye')!, p = world.get(eyeId, 'pos')!, b = world.get(eyeId, 'box');
    const target = [u(p.x) + u(b?.w ?? 0) / 2, u(p.y) + u(b?.h ?? 0) / 2, u(p.z) + u(b?.d ?? 0) / 2];
    const lamps: Lamp[] = world.query('light', 'pos').map((id) => {
      const l = world.get(id, 'light')!, at = world.get(id, 'pos')!, size = world.get(id, 'box');
      return { p: [u(at.x) + u(size?.w ?? 0) / 2, u(at.y) + u(size?.h ?? 0) / 2, u(at.z) + u(size?.d ?? 0) / 2], color: rgb(l.color as string).map((c) => c * u(l.power)), range: u(l.range) };
    });
    renderer.draw(boxes, [target[0] + u(e.x), target[1] + u(e.y), target[2] + u(e.z)], target, e.fov as number, lamps);
  };

  return { name: renderer.name, draw, read: renderer.read?.bind(renderer) };
}
