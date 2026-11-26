// Minimal WebGL2 renderer: lit boxes with a perspective camera. No dependencies.
// The simulation's y axis points down; it is flipped here so that "up" looks up.

export interface Box3 { p: number[]; s: number[]; color: number[] }
export interface Renderer3 { draw(boxes: Box3[], eye: number[], target: number[], fovDeg: number): void }

const VS = `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
uniform mat4 u_vp;
uniform vec3 u_off;
uniform vec3 u_size;
out vec3 v_normal;
out vec3 v_world;
void main() {
  vec3 w = a_pos * u_size + u_off;
  v_world = vec3(w.x, -w.y, w.z);
  v_normal = vec3(a_normal.x, -a_normal.y, a_normal.z);
  gl_Position = u_vp * vec4(v_world, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec3 v_world;
uniform vec3 u_color;
uniform vec3 u_eye;
out vec4 o;
void main() {
  vec3 n = normalize(v_normal);
  float sun = max(dot(n, normalize(vec3(0.45, 0.8, 0.4))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.5, 0.2, -0.6))), 0.0);
  vec3 c = u_color * (0.32 + 0.62 * sun + 0.14 * fill);
  float fog = clamp(distance(v_world, u_eye) / 60.0, 0.0, 0.6);
  o = vec4(mix(c, vec3(0.078, 0.086, 0.102), fog), 1.0);
}`;

// Unit cube, 6 faces x 2 triangles, each vertex as position + normal.
function cube(): Float32Array {
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

const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]): number[] => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Column-major view-projection matrix. */
function viewProj(eye: number[], target: number[], fovDeg: number, aspect: number): Float32Array {
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
  const t = 1 / Math.tan((fovDeg * Math.PI) / 360), near = 0.1, far = 200;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += proj[k * 4 + row] * view[c * 4 + k];
    out[c * 4 + row] = s;
  }
  return out;
}

/** Returns null when WebGL2 is not available; the caller then keeps the 2D view. */
export function makeRenderer3(canvas: HTMLCanvasElement): Renderer3 | null {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) return null;
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, cube(), gl.STATIC_DRAW);
  for (const [name, offset] of [['a_pos', 0], ['a_normal', 12]] as [string, number][]) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, offset);
  }
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uVp = U('u_vp'), uOff = U('u_off'), uSize = U('u_size'), uColor = U('u_color'), uEye = U('u_eye');

  return {
    draw(boxes, eye, target, fovDeg) {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.078, 0.086, 0.102, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      // Flip y for the camera too, to match the flipped world.
      const e = [eye[0], -eye[1], eye[2]], t = [target[0], -target[1], target[2]];
      gl.uniformMatrix4fv(uVp, false, viewProj(e, t, fovDeg, w / Math.max(h, 1)));
      gl.uniform3fv(uEye, e);
      for (const b of boxes) {
        gl.uniform3fv(uOff, b.p);
        gl.uniform3fv(uSize, b.s);
        gl.uniform3fv(uColor, b.color);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      }
    },
  };
}
