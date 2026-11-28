// Geometry and matrices shared by the renderers. Floats only: none of this reaches the simulation.

// Unit cube, 6 faces x 2 triangles, each vertex as position + normal.
export function cube(): Float32Array {
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const out: number[] = [];
  for (const [n, u, v] of faces) {
    const base = n.map((x) => (x > 0 ? 1 : 0));
    const corner = (a: number, b: number): number[] => base.map((x, i) => x + u[i] * a + v[i] * b);
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) out.push(...corner(a, b), ...n);
  }
  return new Float32Array(out);
}

/**
 * OBJ text -> triangles (position + flat normal), scaled so the mesh's bounding box is
 * the unit cube. OBJ has y up and the simulation has y down, so y is mirrored here and
 * the winding swapped back, which keeps normals pointing outward.
 */
export function parseObj(text: string): Float32Array {
  const v: number[][] = [], tris: number[][][] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f') {
      const idx = t.slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? v.length + i : i - 1; });
      for (let i = 1; i + 1 < idx.length; i++) tris.push([v[idx[0]], v[idx[i]], v[idx[i + 1]]]);
    }
  }
  const lo = [0, 1, 2].map((a) => Math.min(...v.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...v.map((p) => p[a])));
  const unit = (p: number[]): number[] => {
    const u = p.map((x, a) => (hi[a] > lo[a] ? (x - lo[a]) / (hi[a] - lo[a]) : 0.5));
    return [u[0], 1 - u[1], u[2]];
  };
  const out: number[] = [];
  for (const tri of tris) {
    if (tri.some((p) => !p || p.some(Number.isNaN))) continue;
    const [a, c, b] = tri.map(unit);
    const n = norm(cross(sub(b, a), sub(c, a)));
    out.push(...a, ...n, ...b, ...n, ...c, ...n);
  }
  return new Float32Array(out);
}

export const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: number[]): number[] => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Matrices are column-major arrays of 16.
export function lookAt(eye: number[], target: number[]): number[] {
  const f = norm(sub(target, eye));
  // Looking straight down would make the usual up vector useless.
  const r = norm(cross(f, Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0])), u = cross(r, f);
  return [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
}
// Two families of projection: WebGL's clip space has depth -1..1, WebGPU's has 0..1.
export function perspective(fovDeg: number, aspect: number, near: number, far: number): number[] {
  const t = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}
export function perspective01(fovDeg: number, aspect: number, near: number, far: number): number[] {
  const t = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (far * near) / (near - far), 0];
}
export function ortho(half: number, near: number, far: number): number[] {
  return [1 / half, 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
}
export function ortho01(half: number, near: number, far: number): number[] {
  return [1 / half, 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, -1 / (far - near), 0, 0, 0, -near / (far - near), 1];
}
export function mul(a: number[], b: number[]): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
    out[c * 4 + row] = s;
  }
  return out;
}

/** A thing to draw: where its box is, how big, what color, and optionally the name of a mesh to draw inside it. */
export interface Box3 {
  p: number[]; s: number[]; color: number[]; mesh?: string;
  /** Orientation as a quaternion (x, y, z, w) in the simulation's axes, turning the box about its centre. */
  q?: number[];
  /** A moving model's `clip` component, and when it is being looked at: an animation's time comes from the tick alone, so a replay draws the same frames. */
  clip?: import('../src/world.ts').Comp;
  tick?: number;
  hz?: number;
}

/** A point light, in the simulation's axes; the color already carries its power. */
export interface Lamp { p: number[]; color: number[]; range: number }
export const MAX_LAMPS = 32;

/**
 * The 4x4 that takes the unit cube to a box: scaled to its size, turned about its centre,
 * moved to its place, and then the simulation's downward y turned to point up.
 */
export function boxMatrix(out: Float32Array, at: number, b: Box3): void {
  const [sx, sy, sz] = b.s;
  out.fill(0, at, at + 16);
  out[at + 15] = 1;
  if (!b.q) {
    out[at] = sx; out[at + 5] = -sy; out[at + 10] = sz;
    out[at + 12] = b.p[0]; out[at + 13] = -b.p[1]; out[at + 14] = b.p[2];
    return;
  }
  const l = Math.hypot(...b.q) || 1, x = b.q[0] / l, y = b.q[1] / l, z = b.q[2] / l, w = b.q[3] / l;
  const c = [
    [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx],
    [2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy],
    [2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz],
  ];
  for (let i = 0; i < 3; i++) {
    out[at + i * 4] = c[i][0]; out[at + i * 4 + 1] = -c[i][1]; out[at + i * 4 + 2] = c[i][2];
  }
  // The cube's centre (0.5, 0.5, 0.5) has to land on the box's centre.
  const t = [0, 1, 2].map((r) => b.p[r] + b.s[r] / 2 - (c[0][r] + c[1][r] + c[2][r]) / 2);
  out[at + 12] = t[0]; out[at + 13] = -t[1]; out[at + 14] = t[2];
}
export interface Renderer3 {
  /** Which backend draws: 'webgl2' or 'webgpu'. */
  name: string;
  /** `lamps` are drawn by WebGPU only. */
  draw(boxes: Box3[], eye: number[], target: number[], fovDeg: number, lamps?: Lamp[]): void;
  /** Register OBJ text under a name; boxes that ask for it are drawn as that mesh, fitted to their box. */
  addMesh(name: string, obj: string): void;
  /** Register a glTF model under a name, like addMesh. Resolves when its textures are ready. Only WebGPU has it. */
  addModel?(name: string, model: import('./gltf.ts').Model): Promise<void>;
  /** The last frame's pixels (RGBA, top row first), for a renderer whose canvas cannot simply be read. */
  read?(): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null>;
}

export const SUN = [0.45, 0.8, 0.4];
export const SHADOW_SIZE = 2048;
/** The color behind everything, also what distance fades to. */
export const SKY = [0.078, 0.086, 0.102];
