// WebGPU renderer, the main one. It draws what the WebGL2 renderer draws (lit boxes and
// meshes, one shadow-casting sun) but is built for what comes next: every object is an
// instance with its own transform matrix, and each mesh is drawn in one call however
// many objects use it. A mesh has a material; boxes and OBJ meshes use the plain one,
// which shades as before, and glTF models bring metallic-roughness materials with textures.
//
// WebGPU's types are not declared here, so its objects are `any`; the engine has no
// dependency to take them from.
import { boxMatrix, cube, lookAt, mul, norm, ortho01, parseObj, perspective01, sub, SHADOW_SIZE, SKY, SUN } from './mesh.ts';
import type { Box3, Renderer3 } from './mesh.ts';
import type { Model, Poses, Wrap } from './gltf.ts';

const SAMPLES = 4;
// One instance: a 4x4 transform (object's unit cube -> world) and a color.
const INSTANCE_FLOATS = 20;

const FRAME = `
struct Frame { vp: mat4x4f, light: mat4x4f, eye: vec4f, sun: vec4f, sky: vec4f };
@group(0) @binding(0) var<uniform> frame: Frame;
struct Vertex {
  @location(0) pos: vec3f, @location(1) normal: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
  @location(6) color: vec4f, @location(7) uv: vec2f,
};`;

const DEPTH = `${FRAME}
@vertex fn vs(v: Vertex) -> @builtin(position) vec4f {
  return frame.light * (mat4x4f(v.m0, v.m1, v.m2, v.m3) * vec4f(v.pos, 1.0));
}`;

const MAIN = `${FRAME}
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
// kind.x is 0 for the plain material and 1 for a metallic-roughness one.
// surface: metallic, roughness, alpha cutoff, normal scale. extra: occlusion strength, has a normal map.
struct Material { color: vec4f, emissive: vec4f, surface: vec4f, extra: vec4f, kind: vec4f };
@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var textureSampler: sampler;
@group(1) @binding(2) var colorMap: texture_2d<f32>;
@group(1) @binding(3) var surfaceMap: texture_2d<f32>;
@group(1) @binding(4) var normalMap: texture_2d<f32>;
@group(1) @binding(5) var occlusionMap: texture_2d<f32>;
@group(1) @binding(6) var emissiveMap: texture_2d<f32>;
struct Varying {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f, @location(1) world: vec3f, @location(2) shadow: vec4f, @location(3) color: vec3f,
  @location(4) uv: vec2f,
};
const PI = 3.14159265;
// Light from all around, for metallic-roughness materials: a pale sky above, dark ground
// below. It stands in for an environment map, which there is not yet.
const SKY_LIGHT = vec3f(0.55, 0.62, 0.75);
const GROUND_LIGHT = vec3f(0.12, 0.11, 0.10);
fn around(dir: vec3f, blur: f32) -> vec3f {
  return mix(GROUND_LIGHT, SKY_LIGHT, smoothstep(-0.15 - blur, 0.25 + blur, dir.y));
}
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
  o.uv = v.uv;
  return o;
}
@fragment fn fs(f: Varying, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // Texture lookups and screen-space slopes have to come before any branch.
  let base = textureSample(colorMap, textureSampler, f.uv) * material.color;
  let packed = textureSample(surfaceMap, textureSampler, f.uv);
  let bump = textureSample(normalMap, textureSampler, f.uv).xyz * 2.0 - 1.0;
  let occlusion = textureSample(occlusionMap, textureSampler, f.uv).r;
  let glow = textureSample(emissiveMap, textureSampler, f.uv).rgb * material.emissive.rgb;
  let dp1 = dpdx(f.world); let dp2 = dpdy(f.world); let duv1 = dpdx(f.uv); let duv2 = dpdy(f.uv);
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
  let fog = clamp(distance(f.world, frame.eye.xyz) / 60.0, 0.0, 0.6);
  if (material.kind.x == 0.0) {
    let sun = max(facing, 0.0) * lit;
    let fill = max(dot(n, normalize(vec3f(-0.5, 0.2, -0.6))), 0.0);
    let c = f.color * (0.30 + 0.66 * sun + 0.12 * fill);
    return vec4f(mix(c, frame.sky.rgb, fog), 1.0);
  }

  // Metallic-roughness shading, computed in linear light and encoded at the end.
  if (base.a < material.surface.z) { discard; }
  var m = n;
  if (!front) { m = -m; }
  if (material.extra.y > 0.0) {
    // A tangent frame from how position and uv change across the screen, so models need not carry tangents.
    let p2 = cross(dp2, m); let p1 = cross(m, dp1);
    let t = p2 * duv1.x + p1 * duv2.x; let b = p2 * duv1.y + p1 * duv2.y;
    let scale = inverseSqrt(max(max(dot(t, t), dot(b, b)), 1e-12));
    m = normalize(mat3x3f(t * scale, b * scale, m) * (bump * vec3f(material.surface.w, material.surface.w, 1.0)));
  }
  let albedo = base.rgb * pow(f.color, vec3f(2.2));
  let metallic = clamp(material.surface.x * packed.b, 0.0, 1.0);
  let rough = clamp(material.surface.y * packed.g, 0.045, 1.0);
  let v = normalize(frame.eye.xyz - f.world);
  let l = frame.sun.xyz;
  let h = normalize(v + l);
  let nl = max(dot(m, l), 0.0); let nv = max(dot(m, v), 0.001); let nh = max(dot(m, h), 0.0); let vh = max(dot(v, h), 0.0);
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let diffuse = albedo * (1.0 - metallic);
  // Cook-Torrance: GGX distribution, Smith-Schlick visibility, Schlick Fresnel.
  let a2 = pow(rough, 4.0);
  let spread = nh * nh * (a2 - 1.0) + 1.0;
  let d = a2 / (PI * spread * spread);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let g = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  let specular = fresnel * (d * g / (4.0 * nl * nv + 0.0001));
  // The sun's strength is pi, so a white diffuse surface facing it comes out white.
  let direct = ((1.0 - fresnel) * diffuse / PI + specular) * nl * lit * PI;
  let grazing = f0 + (max(vec3f(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
  let shade = mix(1.0, occlusion, material.extra.x);
  let ambient = (diffuse * around(m, 0.6) * 0.45 + grazing * around(reflect(-v, m), rough)) * shade;
  let linear = direct + ambient + glow;
  let c = pow(min(linear, vec3f(1.0)), vec3f(1.0 / 2.2));
  return vec4f(mix(c, frame.sky.rgb, fog), 1.0);
}`;

// Draws a texture's level into the next smaller one; run down the chain it makes the mipmaps.
const SHRINK = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var blur: sampler;
struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Out;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
@fragment fn fs(f: Out) -> @location(0) vec4f { return textureSample(source, blur, f.uv); }`;

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

  // Vertices are position (3), normal (3), uv (2). `material` is a bind group.
  interface Mesh { buffer: any; count: number; material: any }
  const upload = (data: Float32Array, material: any): Mesh => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: USAGE.VERTEX | USAGE.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return { buffer, count: data.length / 8, material };
  };
  /** Position + normal triangles (the cube, OBJ meshes) with a zero uv added. */
  const withUv = (data: Float32Array): Float32Array => {
    const out = new Float32Array((data.length / 6) * 8);
    for (let i = 0; i < data.length / 6; i++) out.set(data.subarray(i * 6, i * 6 + 6), i * 8);
    return out;
  };
  // What a box draws as: a name is a list of meshes, one per material.
  const meshes = new Map<string, Mesh[]>();
  // Models that can move: a pose has vertex buffers of its own (see Model.poses).
  const moving = new Map<string, Poses<Mesh[]>>();

  const buffers = [
    {
      arrayStride: 32,
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 7, offset: 24, format: 'float32x2' }],
    },
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
    // The instance matrix mirrors y, which turns counter-clockwise triangles clockwise on screen.
    primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'cw' },
    multisample: { count: SAMPLES },
  });

  // --- materials and textures ---
  const materialLayout = mainPipeline.getBindGroupLayout(1);
  const shrinkModule = device.createShaderModule({ code: SHRINK });
  const shrinkers = new Map<string, any>();
  const smooth = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  /** Fill in every smaller level of a texture from the one above it. */
  const mipmaps = (texture: any, textureFormat: string, levels: number): void => {
    let pipeline = shrinkers.get(textureFormat);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        layout: 'auto', vertex: { module: shrinkModule, entryPoint: 'vs' },
        fragment: { module: shrinkModule, entryPoint: 'fs', targets: [{ format: textureFormat }] },
      });
      shrinkers.set(textureFormat, pipeline);
    }
    const encoder = device.createCommandEncoder();
    for (let level = 1; level < levels; level++) {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) }, { binding: 1, resource: smooth }],
      }));
      pass.draw(3);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  };
  /** A one-pixel texture, for a material that has no image in that slot. */
  const pixel = (rgba: number[]): any => {
    const texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: TEX.TEXTURE_BINDING | TEX.COPY_DST });
    device.queue.writeTexture({ texture }, new Uint8Array(rgba), {}, [1, 1]);
    return texture.createView();
  };
  const WHITE = pixel([255, 255, 255, 255]), FLAT = pixel([128, 128, 255, 255]);
  const samplers = new Map<string, any>();
  const sampler = (wrapS: Wrap, wrapT: Wrap, linear: boolean): any => {
    const key = `${wrapS} ${wrapT} ${linear}`;
    let made = samplers.get(key);
    if (!made) {
      made = device.createSampler({ addressModeU: wrapS, addressModeV: wrapT, magFilter: linear ? 'linear' : 'nearest', minFilter: 'linear', mipmapFilter: 'linear' });
      samplers.set(key, made);
    }
    return made;
  };
  /** A material's bind group. `maps` are texture views in shader order: color, surface, normal, occlusion, emissive. */
  const makeMaterial = (values: number[], maps: any[], textureSampler: any): any => {
    const data = new Float32Array(20);
    data.set(values);
    const buffer = device.createBuffer({ size: data.byteLength, usage: USAGE.UNIFORM | USAGE.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return device.createBindGroup({
      layout: materialLayout,
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: textureSampler }, ...maps.map((view, i) => ({ binding: 2 + i, resource: view }))],
    });
  };
  const PLAIN = makeMaterial([1, 1, 1, 1], [WHITE, WHITE, FLAT, WHITE, WHITE], sampler('repeat', 'repeat', true));
  const box = upload(withUv(cube()), PLAIN);

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
    let total = 0;
    for (const b of boxes) for (const mesh of (b.clip && moving.get(b.mesh!)?.of(b.clip, b.tick!, b.hz!)) || (b.mesh && meshes.get(b.mesh)) || [box]) {
      let group = groups.get(mesh);
      if (!group) groups.set(mesh, (group = []));
      group.push(b);
      total++;
    }
    for (const poses of moving.values()) poses.sweep();
    if (total * INSTANCE_FLOATS > instances.length) {
      instances = new Float32Array(Math.max(total, instances.length / INSTANCE_FLOATS * 2) * INSTANCE_FLOATS);
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

    const drawAll = (pass: any, shaded: boolean): void => {
      pass.setVertexBuffer(1, instanceBuffer);
      let first = 0;
      for (const [mesh, group] of groups) {
        if (shaded) pass.setBindGroup(1, mesh.material);
        pass.setVertexBuffer(0, mesh.buffer);
        pass.draw(mesh.count, group.length, 0, first);
        first += group.length;
      }
    };
    const encoder = device.createCommandEncoder();
    const shadowPass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    shadowPass.setPipeline(shadowPipeline);
    shadowPass.setBindGroup(0, shadowBind);
    drawAll(shadowPass, false);
    shadowPass.end();
    const mainPass = encoder.beginRenderPass({
      colorAttachments: [{ view: color.createView(), resolveTarget: into.createView(), clearValue: [...SKY, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    mainPass.setPipeline(mainPipeline);
    mainPass.setBindGroup(0, mainBind);
    drawAll(mainPass, true);
    mainPass.end();
    device.queue.submit([encoder.finish()]);
  };

  let last: [Box3[], number[], number[], number] | undefined;
  return {
    name: 'webgpu',
    addMesh(name, obj) {
      const data = parseObj(obj);
      if (data.length) meshes.set(name, [upload(withUv(data), PLAIN)]);
    },
    async addModel(name: string, model: Model) {
      // Each image becomes a texture per color space it is used in: color and glow are sRGB, the rest are plain numbers.
      const made = new Map<string, Promise<any>>();
      const view = (index: number, srgb: boolean, fallback: any): Promise<any> => {
        const image = model.images[model.textures[index]?.image];
        if (!image) return Promise.resolve(fallback);
        const key = `${model.textures[index].image} ${srgb}`;
        let texture = made.get(key);
        if (!texture) {
          made.set(key, (texture = (async () => {
            const bitmap = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
            const textureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', levels = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
            const t = device.createTexture({ size: [bitmap.width, bitmap.height], format: textureFormat, mipLevelCount: levels, usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT });
            device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: t }, [bitmap.width, bitmap.height]);
            mipmaps(t, textureFormat, levels);
            return t.createView();
          })()));
        }
        return texture;
      };
      const materials = await Promise.all(model.materials.map(async (m) => {
        const first = model.textures[[m.colorTex, m.surfaceTex, m.normalTex, m.occlusionTex, m.emissiveTex].find((t) => t >= 0) ?? -1];
        return makeMaterial(
          [...m.color, ...m.emissive, 0, m.metallic, m.roughness, m.cutoff, m.normalScale, m.occlusionTex >= 0 ? m.occlusionStrength : 0, m.normalTex >= 0 ? 1 : 0, 0, 0, 1],
          await Promise.all([view(m.colorTex, true, WHITE), view(m.surfaceTex, false, WHITE), view(m.normalTex, false, FLAT), view(m.occlusionTex, false, WHITE), view(m.emissiveTex, true, WHITE)]),
          sampler(first?.wrapS ?? 'repeat', first?.wrapT ?? 'repeat', first?.smooth ?? true),
        );
      }));
      const parts = model.parts.filter((p) => p.data.length).map((p) => upload(p.data, materials[p.material]));
      if (!parts.length) return;
      meshes.set(name, parts);
      if (model.clips.length) moving.set(name, model.poses(
        () => parts.map((p) => upload(new Float32Array(p.count * 8), p.material)),
        (into, data) => into.forEach((mesh, i) => device.queue.writeBuffer(mesh.buffer, 0, data[i])),
      ));
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
