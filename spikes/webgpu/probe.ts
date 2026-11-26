// Can a headless browser on this machine give us WebGPU, and with which adapter?
// Draws one triangle to a texture, runs one compute pass, reads both back.
//   node spikes/webgpu/probe.ts            default switches for this platform
//   node spikes/webgpu/probe.ts software   ask for the software adapter (what CI has)
import { createServer } from 'node:http';
import { launch } from '../../src/chrome.ts';

const PAGE = `<!doctype html><meta charset="utf-8"><title>probe</title><script>
async function probe(forceFallback) {
  if (!navigator.gpu) return { ok: false, why: 'navigator.gpu is missing', secure: isSecureContext };
  const adapter = await navigator.gpu.requestAdapter(forceFallback ? { forceFallbackAdapter: true } : {});
  if (!adapter) return { ok: false, why: 'requestAdapter returned null' };
  const info = adapter.info ?? {};
  const wantTiming = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: wantTiming ? ['timestamp-query'] : [] });
  const problems = [];
  device.addEventListener('uncapturederror', (e) => problems.push(e.error.message));

  // Render: one triangle covering the target, a fixed color.
  const size = 64, format = 'rgba8unorm';
  const target = device.createTexture({ size: [size, size], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const draw = device.createShaderModule({ code: \`
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      return vec4f(p[i], 0, 1);
    }
    @fragment fn fs() -> @location(0) vec4f { return vec4f(1.0, 0.5, 0.25, 1.0); }\` });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: draw, entryPoint: 'vs' }, fragment: { module: draw, entryPoint: 'fs', targets: [{ format }] } });

  // Compute: out[i] = i * i for 16 values.
  const cells = 16;
  const store = device.createBuffer({ size: cells * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const calc = device.createShaderModule({ code: \`
    @group(0) @binding(0) var<storage, read_write> out: array<u32>;
    @compute @workgroup_size(16) fn main(@builtin(global_invocation_id) id: vec3u) { out[id.x] = id.x * id.x; }\` });
  const compute = device.createComputePipeline({ layout: 'auto', compute: { module: calc, entryPoint: 'main' } });
  const bind = device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: store } }] });

  const pixels = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const values = device.createBuffer({ size: cells * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  pass.setPipeline(pipeline); pass.draw(3); pass.end();
  const work = encoder.beginComputePass();
  work.setPipeline(compute); work.setBindGroup(0, bind); work.dispatchWorkgroups(1); work.end();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: pixels, bytesPerRow: size * 4 }, [size, size]);
  encoder.copyBufferToBuffer(store, 0, values, 0, cells * 4);
  device.queue.submit([encoder.finish()]);
  await Promise.all([pixels.mapAsync(GPUMapMode.READ), values.mapAsync(GPUMapMode.READ)]);
  const rgba = new Uint8Array(pixels.getMappedRange());
  const mid = (size / 2 * size + size / 2) * 4;
  const pixel = Array.from(rgba.slice(mid, mid + 4));
  const squares = Array.from(new Uint32Array(values.getMappedRange()));
  const drew = pixel[0] === 255 && Math.abs(pixel[1] - 128) <= 1 && Math.abs(pixel[2] - 64) <= 1 && pixel[3] === 255;
  const computed = squares.every((v, i) => v === i * i);
  return {
    ok: drew && computed && problems.length === 0, drew, computed, pixel, problems,
    adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, fallback: info.isFallbackAdapter ?? adapter.isFallbackAdapter },
    timestampQuery: wantTiming,
    maxTextureSize: device.limits.maxTextureDimension2D,
    maxComputeInvocations: device.limits.maxComputeInvocationsPerWorkgroup,
  };
}
</script>`;

// Switches that ask Chrome for a software Vulkan adapter, for machines without a GPU.
// Measured on Windows (Chrome 158): adding --enable-features=Vulkan or --use-angle=swiftshader there
// makes requestAdapter return null, so the Vulkan switch is Linux only.
const SOFTWARE = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : [])];
const HARDWARE = ['--enable-unsafe-webgpu', ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : [])];

const mode = process.argv[2] === 'software' ? 'software' : 'default';
// Further arguments replace the switches, to try combinations: probe.ts software --flag-a --flag-b
const override = process.argv.slice(3);
const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
const port = (server.address() as import('node:net').AddressInfo).port;

const browser = await launch({ args: override.length ? override : mode === 'software' ? SOFTWARE : HARDWARE });
let code = 1;
try {
  const page = await browser.open(`http://127.0.0.1:${port}/`);
  const version = await page.eval<string>('navigator.userAgent');
  const result = await page.eval<{ ok: boolean }>(`probe(${mode === 'software'})`);
  console.log(JSON.stringify({ platform: process.platform, mode, switches: override.length ? override : undefined, browser: /Chrome\/[\d.]+|Edg\/[\d.]+/.exec(version)?.[0], ...result }, null, 1));
  code = result.ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
