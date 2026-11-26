import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** A decoded picture: 8-bit RGBA, rows top to bottom. */
export interface Picture { width: number; height: number; rgba: Uint8Array }

/**
 * Decode a PNG as browsers write them: 8 bits a channel, RGB or RGBA, not interlaced.
 * Anything else is refused by name rather than decoded wrongly.
 */
export function decodePng(file: Uint8Array): Picture {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG file');
  let width = 0, height = 0, channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8], color = body[9], interlace = body[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, color type ${color}, interlace ${interlace})`);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!width || !height) throw new Error('PNG has no header');
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is cut short');
  const rows = new Uint8Array(stride * height), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[dst + x - channels] : 0;
      const up = y > 0 ? rows[dst + x - stride] : 0;
      const corner = x >= channels && y > 0 ? rows[dst + x - stride - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rows[dst + x] = (raw[src + x] + predicted) & 255;
    }
  }
  for (let i = 0, o = 0; i < rows.length; i += channels, o += 4) {
    rgba[o] = rows[i]; rgba[o + 1] = rows[i + 1]; rgba[o + 2] = rows[i + 2];
    rgba[o + 3] = channels === 4 ? rows[i + 3] : 255;
  }
  return { width, height, rgba };
}

/** What a picture shows, in numbers an agent can read without opening it. */
export interface Summary {
  /** Share of pixels that differ from the background (the commonest color), 0..1. */
  drawn: number;
  /** Distinct colors after dropping the low 4 bits of each channel. */
  colors: number;
  /** Smallest rectangle holding every non-background pixel, or null if the frame is one flat color. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

export function summarize(p: Picture): Summary {
  const counts = new Map<number, number>();
  const key = (i: number): number => ((p.rgba[i] >> 4) << 8) | ((p.rgba[i + 1] >> 4) << 4) | (p.rgba[i + 2] >> 4);
  for (let i = 0; i < p.rgba.length; i += 4) counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
  let background = 0, most = -1;
  for (const [k, n] of counts) if (n > most) { most = n; background = k; }
  let x0 = p.width, y0 = p.height, x1 = -1, y1 = -1, drawn = 0;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    if (key((y * p.width + x) * 4) === background) continue;
    drawn++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { drawn: drawn / (p.width * p.height), colors: counts.size, box: x1 < 0 ? null : { x0, y0, x1, y1 } };
}

/** How far two pictures are apart. */
export interface Difference {
  /** False when the sizes differ; the other numbers are then meaningless. */
  sameSize: boolean;
  /** Share of pixels where some channel differs by more than the tolerance, 0..1. */
  changed: number;
  /** Largest difference in any channel of any pixel, 0..255. */
  worst: number;
}

/**
 * Compare two pictures with a tolerance. Small per-channel differences (rounding in a
 * shader, a changed dither) are ignored; what counts is the share of pixels that moved
 * by more than that.
 */
export function compare(a: Picture, b: Picture, channelTolerance = 8): Difference {
  if (a.width !== b.width || a.height !== b.height) return { sameSize: false, changed: 1, worst: 255 };
  let changed = 0, worst = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const d = Math.max(Math.abs(a.rgba[i] - b.rgba[i]), Math.abs(a.rgba[i + 1] - b.rgba[i + 1]), Math.abs(a.rgba[i + 2] - b.rgba[i + 2]), Math.abs(a.rgba[i + 3] - b.rgba[i + 3]));
    if (d > worst) worst = d;
    if (d > channelTolerance) changed++;
  }
  return { sameSize: true, changed: changed / (a.width * a.height), worst };
}

/** Write a picture as a PNG (RGBA, no filtering). Used for difference images and in tests. */
export function encodePng(p: Picture): Buffer {
  const stride = p.width * 4, raw = Buffer.alloc((stride + 1) * p.height);
  for (let y = 0; y < p.height; y++) raw.set(p.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const chunk = (type: string, body: Buffer): Buffer => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(p.width, 0);
  header.writeUInt32BE(p.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
