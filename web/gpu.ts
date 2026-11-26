// WebGPU renderer, the main one. It draws what the WebGL2 renderer draws (lit boxes and
// meshes, one shadow-casting sun) but is built for what comes next: every object is an
// instance with its own transform matrix, and each mesh is drawn in one call however
// many objects use it.
//
// WebGPU's types are not declared here, so its objects are `any`; the engine has no
// dependency to take them from.
import { boxMatrix, cube, lookAt, mul, norm, ortho01, parseObj, perspective01, sub, SHADOW_SIZE, SKY, SUN } from './mesh.ts';
import type { Box3, Renderer3 } from './mesh.ts';

const SAMPLES = 4;
// One instance: a 4x4 transform (object's unit cube -> world) and a color.
const INSTANCE_FLOATS = 20;

const FRAME = `
struct Frame { vp: mat4x4f, light: mat4x4f, eye: vec4f, sun: vec4f, sky: vec4f };
@group(0) @binding(0) var<uniform> frame: Frame;
struct Vertex {
  @location(0) pos: vec3f, @location(1) normal: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
  @location(6) color: vec4f,
};`;

const DEPTH = `${FRAME}
@vertex fn vs(v: Vertex) -> @builtin(position) vec4f {
  return frame.light * (mat4x4f(v.m0, v.m1, v.m2, v.m3) * vec4f(v.pos, 1.0));
}`;

const MAIN = `${FRAME}
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
struct Varying {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f, @location(1) world: vec3f, @location(2) shadow: vec4f, @location(3) color: vec3f,
};
@vertex fn vs(v: Vertex) -> Varying {
  let world = mat4x4f(v.m0, v.m1, v.m2, v.m3) * vec4f(v.pos, 1.0);
  // The transform may stretch each axis differently, so normals are divided by the
  // squared stretch before being turned: the inverse transpose, without inverting.
  let stretch = vec3f(dot(v.m0.xyz, v.m0.xyz), dot(v.m1.xyz, v.m1.xyz), dot(v.m2.xyz, v.m2.xyz));
  var o: Varying;
  o.normal = mat3x3f(v.m0.xyz, v.m1.xyz, v.m2.xyz) * (v.normal / stretch);
  o.world = world.xyz;
  o.shadow = frame.light * world;
  o.clip = frame.vp * world;
  o.color = v.color.rgb;
  return o;
}
@fragment fn fs(f: Varying) -> @location(0) vec4f {
  let n = normalize(f.normal);
  let facing = dot(n, frame.sun.xyz);
  // Shadow lookup with a slope-scaled bias and a 2x2 soft edge.
  let s = f.shadow.xyz / f.shadow.w;
  let uv = s.xy * vec2f(0.5, -0.5) + 0.5;
  let bias = mix(0.004, 0.0012, clamp(facing, 0.0, 1.0));
  let texel = 1.0 / ${SHADOW_SIZE}.0;
  var lit = 0.0;
  for (var x = 0; x < 2; x++) { for (var y = 0; y < 2; y++) {
    lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + (vec2f(f32(x), f32(y)) - 0.5) * texel, s.z - bias);
  } }
  lit *= 0.25;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || s.z > 1.0) { lit = 1.0; }
  let sun = max(facing, 0.0) * lit;
  let fill = max(dot(n, normalize(vec3f(-0.5, 0.2, -0.6))), 0.0);
  let c = f.color * (0.30 + 0.66 * sun + 0.12 * fill);
  let fog = clamp(distance(f.world, frame.eye.xyz) / 60.0, 0.0, 0.6);
  return vec4f(mix(c, frame.sky.rgb, fog), 1.0);
}`;

/**
 * Resolves to null when WebGPU is not available; the caller then falls back to WebGL2.
 * With `offscreen` nothing is shown: frames exist only for `read`. That is for taking
 * pictures on machines where presenting to a canvas is the part that does not work.
 */
export async function makeRendererGpu(canvas: HTMLCanvasElement, offscreen = false): Promise<Renderer3 | null> {
  const gpu = (navigator as any).gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  // A canvas keeps the first kind of context it gives out, so this is asked for last.
  const context = offscreen ? null : canvas.getContext('webgpu') as any;
  if (!offscreen && !context) return null;
  const format = offscreen ? 'rgba8unorm' : gpu.getPreferredCanvasFormat();
  context?.configure({ device, format, alphaMode: 'opaque' });
  // Validation errors and a lost device would otherwise pass silently and leave a blank frame.
  device.addEventListener('uncapturederror', (e: any) => console.error(`webgpu: ${e.error.message}`));
  device.lost.then((info: any) => console.error(`webgpu: device lost (${info.reason}): ${info.message}`));
  const USAGE = (globalThis as any).GPUBufferUsage, TEX = (globalThis as any).GPUTextureUsage;

  interface Mesh { buffer: any; count: number }
  const upload = (data: Float32Array): Mesh => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: USAGE.VERTEX | USAGE.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return { buffer, count: data.length / 6 };
  };
  const box = upload(cube());
  const meshes = new Map<string, Mesh>();

  const buffers = [
    { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
    {
      arrayStride: INSTANCE_FLOATS * 4, stepMode: 'instance',
      attributes: [0, 1, 2, 3, 4].map((i) => ({ shaderLocation: 2 + i, offset: i * 16, format: 'float32x4' })),
    },
  ];
  const depthModule = device.createShaderModule({ code: DEPTH }), mainModule = device.createShaderModule({ code: MAIN });
  const shadowPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: depthModule, entryPoint: 'vs', buffers },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });
  const mainPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: mainModule, entryPoint: 'vs', buffers },
    fragment: { module: mainModule, entryPoint: 'fs', targets: [{ format }] },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    multisample: { count: SAMPLES },
  });

  // Depth-only target the sun renders into.
  const shadowMap = device.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: TEX.RENDER_ATTACHMENT | TEX.TEXTURE_BINDING });
  const shadowView = shadowMap.createView();
  const frame = new Float32Array(16 + 16 + 4 + 4 + 4);
  const frameBuffer = device.createBuffer({ size: frame.byteLength, usage: USAGE.UNIFORM | USAGE.COPY_DST });
  const shadowBind = device.createBindGroup({ layout: shadowPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: frameBuffer } }] });
  const mainBind = device.createBindGroup({
    layout: mainPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: frameBuffer } },
      { binding: 1, resource: shadowView },
      { binding: 2, resource: device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' }) },
    ],
  });

  let instances = new Float32Array(256 * INSTANCE_FLOATS);
  let instanceBuffer = device.createBuffer({ size: instances.byteLength, usage: USAGE.VERTEX | USAGE.COPY_DST });
  // Multisampled color and depth, remade when the canvas changes size.
  let color: any, depth: any, sizedFor = '';
  const sun = norm(SUN);

  // Match the canvas and the multisampled targets to the size the page shows the canvas at.
  // This has to happen before the canvas is asked for its texture, which takes the canvas's size.
  const fit = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (sizedFor !== `${w}x${h}`) {
      color?.destroy();
      depth?.destroy();
      color = device.createTexture({ size: [w, h], format, sampleCount: SAMPLES, usage: TEX.RENDER_ATTACHMENT });
      depth = device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: SAMPLES, usage: TEX.RENDER_ATTACHMENT });
      sizedFor = `${w}x${h}`;
    }
  };

  // Draw one frame into `into`, a texture of the canvas's size and format.
  const render = (boxes: Box3[], eye: number[], target: number[], fovDeg: number, into: any): void => {
    const w = canvas.width, h = canvas.height;

    // Instances, grouped so that each mesh is one draw call.
    const groups = new Map<Mesh, Box3[]>();
    for (const b of boxes) {
      const mesh = (b.mesh && meshes.get(b.mesh)) || box;
      let group = groups.get(mesh);
      if (!group) groups.set(mesh, (group = []));
      group.push(b);
    }
    if (boxes.length * INSTANCE_FLOATS > instances.length) {
      instances = new Float32Array(Math.max(boxes.length, instances.length / INSTANCE_FLOATS * 2) * INSTANCE_FLOATS);
      instanceBuffer.destroy();
      instanceBuffer = device.createBuffer({ size: instances.byteLength, usage: USAGE.VERTEX | USAGE.COPY_DST });
    }
    let at = 0;
    for (const group of groups.values()) for (const b of group) {
      boxMatrix(instances, at, b);
      instances[at + 16] = b.color[0]; instances[at + 17] = b.color[1]; instances[at + 18] = b.color[2]; instances[at + 19] = 1;
      at += INSTANCE_FLOATS;
    }
    device.queue.writeBuffer(instanceBuffer, 0, instances, 0, at);

    // The sun's box: centred on what the camera looks at, wide enough for the area around it.
    const t = [target[0], -target[1], target[2]], e = [eye[0], -eye[1], eye[2]];
    const reach = Math.max(14, Math.hypot(...sub(e, t)) * 1.6);
    const light = mul(ortho01(reach, 0.1, reach * 4), lookAt([t[0] + sun[0] * reach * 2, t[1] + sun[1] * reach * 2, t[2] + sun[2] * reach * 2], t));
    frame.set(mul(perspective01(fovDeg, w / h, 0.1, 200), lookAt(e, t)), 0);
    frame.set(light, 16);
    frame.set(e, 32);
    frame.set(sun, 36);
    frame.set(SKY, 40);
    device.queue.writeBuffer(frameBuffer, 0, frame);

    const drawAll = (pass: any): void => {
      pass.setVertexBuffer(1, instanceBuffer);
      let first = 0;
      for (const [mesh, group] of groups) {
        pass.setVertexBuffer(0, mesh.buffer);
        pass.draw(mesh.count, group.length, 0, first);
        first += group.length;
      }
    };
    const encoder = device.createCommandEncoder();
    const shadowPass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    shadowPass.setPipeline(shadowPipeline);
    shadowPass.setBindGroup(0, shadowBind);
    drawAll(shadowPass);
    shadowPass.end();
    const mainPass = encoder.beginRenderPass({
      colorAttachments: [{ view: color.createView(), resolveTarget: into.createView(), clearValue: [...SKY, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    mainPass.setPipeline(mainPipeline);
    mainPass.setBindGroup(0, mainBind);
    drawAll(mainPass);
    mainPass.end();
    device.queue.submit([encoder.finish()]);
  };

  let last: [Box3[], number[], number[], number] | undefined;
  return {
    name: 'webgpu',
    addMesh(name, obj) {
      const data = parseObj(obj);
      if (data.length) meshes.set(name, upload(data));
    },
    draw(boxes, eye, target, fovDeg) {
      last = [boxes, eye, target, fovDeg];
      fit();
      if (context) render(boxes, eye, target, fovDeg, context.getCurrentTexture());
    },
    // The canvas cannot be read back reliably: with software rendering on Linux it comes
    // back blank. So the last frame is drawn again into a texture and copied out of that.
    async read() {
      if (!last) return null;
      const w = canvas.width, h = canvas.height, rowBytes = Math.ceil((w * 4) / 256) * 256;
      const texture = device.createTexture({ size: [w, h], format, usage: TEX.RENDER_ATTACHMENT | TEX.COPY_SRC });
      const buffer = device.createBuffer({ size: rowBytes * h, usage: USAGE.COPY_DST | USAGE.MAP_READ });
      render(...last, texture);
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: rowBytes }, [w, h]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync((globalThis as any).GPUMapMode.READ);
      const padded = new Uint8Array(buffer.getMappedRange()), rgba = new Uint8ClampedArray(w * h * 4);
      const swap = String(format).startsWith('bgra');
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const from = y * rowBytes + x * 4, to = (y * w + x) * 4;
        rgba[to] = padded[from + (swap ? 2 : 0)];
        rgba[to + 1] = padded[from + 1];
        rgba[to + 2] = padded[from + (swap ? 0 : 2)];
        rgba[to + 3] = 255;
      }
      buffer.unmap();
      buffer.destroy();
      texture.destroy();
      return { width: w, height: h, rgba };
    },
  };
}
