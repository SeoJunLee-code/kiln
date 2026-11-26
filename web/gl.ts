// Minimal WebGL2 renderer: lit boxes with a perspective camera and one shadow-casting
// sun. No dependencies. The simulation's y axis points down; it is flipped here so that
// "up" looks up.

import { cube, lookAt, mul, norm, ortho, parseObj, perspective, sub, SHADOW_SIZE, SUN } from './mesh.ts';
import type { Box3, Renderer3 } from './mesh.ts';

export { parseObj } from './mesh.ts';
export type { Box3, Renderer3 } from './mesh.ts';

const VS = `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
uniform mat4 u_vp;
uniform mat4 u_light;
uniform vec3 u_off;
uniform vec3 u_size;
out vec3 v_normal;
out vec3 v_world;
out vec4 v_shadow;
void main() {
  vec3 w = a_pos * u_size + u_off;
  v_world = vec3(w.x, -w.y, w.z);
  // Meshes live in a unit cube that is stretched to the box, so normals are un-stretched.
  vec3 n = a_normal / u_size;
  v_normal = vec3(n.x, -n.y, n.z);
  v_shadow = u_light * vec4(v_world, 1.0);
  gl_Position = u_vp * vec4(v_world, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
precision mediump sampler2DShadow;
in vec3 v_normal;
in vec3 v_world;
in vec4 v_shadow;
uniform vec3 u_color;
uniform vec3 u_eye;
uniform vec3 u_sun;
uniform sampler2DShadow u_map;
out vec4 o;
void main() {
  vec3 n = normalize(v_normal);
  float facing = dot(n, u_sun);
  // Shadow lookup with a slope-scaled bias and a 2x2 soft edge.
  vec3 s = v_shadow.xyz / v_shadow.w * 0.5 + 0.5;
  float bias = mix(0.004, 0.0012, clamp(facing, 0.0, 1.0));
  float lit = 0.0;
  float texel = 1.0 / ${SHADOW_SIZE}.0;
  for (int x = 0; x < 2; x++) for (int y = 0; y < 2; y++) {
    lit += texture(u_map, vec3(s.xy + (vec2(x, y) - 0.5) * texel, s.z - bias));
  }
  lit *= 0.25;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) lit = 1.0;
  float sun = max(facing, 0.0) * lit;
  float fill = max(dot(n, normalize(vec3(-0.5, 0.2, -0.6))), 0.0);
  vec3 c = u_color * (0.30 + 0.66 * sun + 0.12 * fill);
  float fog = clamp(distance(v_world, u_eye) / 60.0, 0.0, 0.6);
  o = vec4(mix(c, vec3(0.078, 0.086, 0.102), fog), 1.0);
}`;

const FS_DEPTH = `#version 300 es
precision mediump float;
void main() {}`;

/** Returns null when WebGL2 is not available; the caller then keeps the 2D view. */
export function makeRenderer3(canvas: HTMLCanvasElement): Renderer3 | null {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) return null;
  const program = (vs: string, fs: string): WebGLProgram => {
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as [number, string][]) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(prog, s);
    }
    // Both programs share one vertex layout.
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_normal');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    return prog;
  };
  const main = program(VS, FS), depth = program(VS, FS_DEPTH);

  interface Mesh { vao: WebGLVertexArrayObject | null; count: number }
  const upload = (data: Float32Array): Mesh => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    return { vao, count: data.length / 6 };
  };
  const box = upload(cube());
  const meshes = new Map<string, Mesh>();

  // Depth-only target the sun renders into.
  const map = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, map);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, map, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const sun = norm(SUN);
  const boxesPass = (prog: WebGLProgram, boxes: Box3[], color: boolean): void => {
    const uOff = gl.getUniformLocation(prog, 'u_off'), uSize = gl.getUniformLocation(prog, 'u_size');
    const uColor = color ? gl.getUniformLocation(prog, 'u_color') : null;
    for (const b of boxes) {
      gl.uniform3fv(uOff, b.p);
      gl.uniform3fv(uSize, b.s);
      if (uColor) gl.uniform3fv(uColor, b.color);
      const m = (b.mesh && meshes.get(b.mesh)) || box;
      gl.bindVertexArray(m.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
  };

  return {
    name: 'webgl2',
    addMesh(name, obj) {
      const data = parseObj(obj);
      if (data.length) meshes.set(name, upload(data));
    },
    draw(boxes, eye, target, fovDeg) {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.enable(gl.DEPTH_TEST);

      // The sun's box: centred on what the camera looks at, wide enough for the area around it.
      const t = [target[0], -target[1], target[2]], e = [eye[0], -eye[1], eye[2]];
      const reach = Math.max(14, Math.hypot(...sub(e, t)) * 1.6);
      const lightVp = mul(ortho(reach, 0.1, reach * 4), lookAt([t[0] + sun[0] * reach * 2, t[1] + sun[1] * reach * 2, t[2] + sun[2] * reach * 2], t));

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(depth);
      gl.uniformMatrix4fv(gl.getUniformLocation(depth, 'u_vp'), false, lightVp);
      boxesPass(depth, boxes, false);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.078, 0.086, 0.102, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(main);
      gl.uniformMatrix4fv(gl.getUniformLocation(main, 'u_vp'), false, mul(perspective(fovDeg, w / Math.max(h, 1), 0.1, 200), lookAt(e, t)));
      gl.uniformMatrix4fv(gl.getUniformLocation(main, 'u_light'), false, lightVp);
      gl.uniform3fv(gl.getUniformLocation(main, 'u_eye'), e);
      gl.uniform3fv(gl.getUniformLocation(main, 'u_sun'), sun);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, map);
      gl.uniform1i(gl.getUniformLocation(main, 'u_map'), 0);
      boxesPass(main, boxes, true);
    },
  };
}
