import {
  HandState,
  FINGER_ORDER,
  norm,
  cleanPose,
  defaultState,
} from './core.ts';
import { handMarkup } from './render.ts';

export const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 4294967295;
  for (const b of bytes) {
    crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 4294967295) >>> 0;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const body = concatBytes([name, data]);
  const out = new Uint8Array(body.length + 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  out.set(body, 4);
  dv.setUint32(body.length + 4, crc32(body), false);
  return out;
}

export async function compressPngPixels(rgba: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser does not support CompressionStream for APNG; use a current browser release.');
  }
  const rowBytes = w * 4;
  const raw = new Uint8Array((rowBytes + 1) * h);
  for (let y = 0; y < h; y++) {
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function pngHeader(w: number, h: number): Uint8Array[] {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w, false);
  dv.setUint32(4, h, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return [sig, pngChunk('IHDR', ihdr)];
}

export function encodeApng(compressedFrames: Uint8Array[], w: number, h: number, fps: number): Blob {
  const parts = pngHeader(w, h);
  const actl = new Uint8Array(8);
  const ad = new DataView(actl.buffer);
  ad.setUint32(0, compressedFrames.length, false);
  ad.setUint32(4, 0, false);
  parts.push(pngChunk('acTL', actl));
  let seq = 0;
  for (let i = 0; i < compressedFrames.length; i++) {
    const fctl = new Uint8Array(26);
    const dv = new DataView(fctl.buffer);
    dv.setUint32(0, seq++, false);
    dv.setUint32(4, w, false);
    dv.setUint32(8, h, false);
    dv.setUint32(12, 0, false);
    dv.setUint32(16, 0, false);
    dv.setUint16(20, 1, false);
    dv.setUint16(22, fps, false);
    fctl[24] = 0;
    fctl[25] = 0;
    parts.push(pngChunk('fcTL', fctl));
    if (i === 0) {
      parts.push(pngChunk('IDAT', compressedFrames[i]));
    } else {
      const data = new Uint8Array(compressedFrames[i].length + 4);
      new DataView(data.buffer).setUint32(0, seq++, false);
      data.set(compressedFrames[i], 4);
      parts.push(pngChunk('fdAT', data));
    }
  }
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts as BlobPart[], { type: 'image/apng' });
}

export function gifPalette(): Uint8Array {
  const table = new Uint8Array(768);
  table[0] = 226;
  table[1] = 226;
  table[2] = 232;
  for (let i = 1; i < 256; i++) {
    const q = i - 1;
    table[i * 3] = Math.round(((q >> 5) & 7) * 255 / 7);
    table[i * 3 + 1] = Math.round(((q >> 2) & 7) * 255 / 7);
    table[i * 3 + 2] = Math.round((q & 3) * 255 / 3);
  }
  return table;
}

export function gifIndices(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let s = 0, d = 0; s < rgba.length; s += 4, d++) {
    if (rgba[s + 3] < 128) {
      out[d] = 0;
    } else {
      const q = (rgba[s] >> 5) * 32 + (rgba[s + 1] >> 5) * 4 + (rgba[s + 2] >> 6);
      out[d] = q === 255 ? 255 : q + 1;
    }
  }
  return out;
}

export function gifLzw(data: Uint8Array): Uint8Array {
  const clear = 256;
  const end = 257;
  const dict = new Map<number, number>();
  const out: number[] = [];
  let next = 258;
  let bits = 9;
  let acc = 0;
  let bitCount = 0;
  const write = (code: number, size: number) => {
    acc |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bitCount -= 8;
    }
  };
  write(clear, bits);
  if (data.length) {
    let prefix = data[0];
    for (let i = 1; i < data.length; i++) {
      const value = data[i];
      const key = (prefix << 8) | value;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
      } else {
        write(prefix, bits);
        if (next < 4096) {
          dict.set(key, next++);
          if (next === 1 << bits && bits < 12) bits++;
        } else {
          write(clear, bits);
          dict.clear();
          next = 258;
          bits = 9;
        }
        prefix = value;
      }
    }
    write(prefix, bits);
  }
  write(end, bits);
  if (bitCount) out.push(acc & 255);
  return Uint8Array.from(out);
}

export function le16(v: number): [number, number] {
  return [v & 255, (v >> 8) & 255];
}

export function gifFrame(indices: Uint8Array, w: number, h: number, fps: number): Uint8Array {
  const delay = Math.max(2, Math.round(100 / fps));
  const compressed = gifLzw(indices);
  const bytes = [
    33, 249, 4, 9,
    ...le16(delay),
    0, 0,
    44,
    ...le16(0),
    ...le16(0),
    ...le16(w),
    ...le16(h),
    0, 8,
  ];
  for (let i = 0; i < compressed.length; i += 255) {
    const block = compressed.subarray(i, i + 255);
    bytes.push(block.length);
    for (const v of block) bytes.push(v);
  }
  bytes.push(0);
  return Uint8Array.from(bytes);
}

export function gifHeader(w: number, h: number): Uint8Array[] {
  const header = Uint8Array.from([71, 73, 70, 56, 57, 97, ...le16(w), ...le16(h), 247, 0, 0]);
  const loop = Uint8Array.from([33, 255, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0]);
  return [header, gifPalette(), loop];
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

export function zipStore(files: ZipFile[]): Blob {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30);
    const ld = new DataView(lh.buffer);
    ld.setUint32(0, 67324752, true);
    ld.setUint16(4, 20, true);
    ld.setUint16(6, 2048, true);
    ld.setUint16(8, 0, true);
    ld.setUint16(10, 0, true);
    ld.setUint16(12, 33, true);
    ld.setUint32(14, crc, true);
    ld.setUint32(18, data.length, true);
    ld.setUint32(22, data.length, true);
    ld.setUint16(26, name.length, true);
    ld.setUint16(28, 0, true);
    local.push(lh, name, data);
    const ch = new Uint8Array(46);
    const cd = new DataView(ch.buffer);
    cd.setUint32(0, 33639248, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 2048, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true);
    cd.setUint16(14, 33, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const csize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22);
  const ed = new DataView(end.buffer);
  ed.setUint32(0, 101010256, true);
  ed.setUint16(4, 0, true);
  ed.setUint16(6, 0, true);
  ed.setUint16(8, files.length, true);
  ed.setUint16(10, files.length, true);
  ed.setUint32(12, csize, true);
  ed.setUint32(16, offset, true);
  return new Blob([...local, ...central, end] as BlobPart[], { type: 'application/zip' });
}

export function interpolatePose(from: Partial<HandState>, to: Partial<HandState>, t: number): HandState {
  const a = cleanPose(from);
  const b = cleanPose(to);
  if (t <= 0) return { ...defaultState(), ...a } as HandState;
  if (t >= 1) return { ...defaultState(), ...b } as HandState;
  const p = defaultState();
  p.build = t < 0.5 ? a.build || 'standard' : b.build || 'standard';
  p.expert = !!(a.expert || b.expert);
  p.o = t < 0.5 ? (a.o ?? 0.5) : (b.o ?? 0.5);
  p.wscale = t < 0.5 ? !!a.wscale : !!b.wscale;
  p.boxes = t < 0.5 ? !!a.boxes : !!b.boxes;
  p.skin = t < 0.5 ? (a.skin ?? true) : (b.skin ?? true);
  p.wrist = Math.round(norm((a.wrist ?? 0) + norm((b.wrist ?? 0) - (a.wrist ?? 0)) * t));
  p.splay = Math.round((a.splay ?? 0) + ((b.splay ?? 0) - (a.splay ?? 0)) * t);
  p.thumb = Math.round((a.thumb ?? 0) + ((b.thumb ?? 0) - (a.thumb ?? 0)) * t);
  p.tilt = Math.round((a.tilt ?? 0) + ((b.tilt ?? 0) - (a.tilt ?? 0)) * t);
  for (const d of ['index', 'ring', 'pinky'] as const) {
    p.fs[d] = Math.round((a.fs?.[d] ?? 0) + ((b.fs?.[d] ?? 0) - (a.fs?.[d] ?? 0)) * t);
  }
  for (const d of FINGER_ORDER) {
    p.rot[d] = Math.round((a.rot?.[d] ?? 0) + ((b.rot?.[d] ?? 0) - (a.rot?.[d] ?? 0)) * t);
    const aCj = a.cj?.[d] ?? [0, 0, 0];
    const bCj = b.cj?.[d] ?? [0, 0, 0];
    p.cj[d] = [
      Math.round(aCj[0] + (bCj[0] - aCj[0]) * t),
      Math.round(aCj[1] + (bCj[1] - aCj[1]) * t),
      Math.round(aCj[2] + (bCj[2] - aCj[2]) * t),
    ];
  }
  return p;
}

export function squareViewBox(b: { x: number; y: number; width: number; height: number }): string {
  const max = Math.max(b.width, b.height, 1);
  const pad = Math.max(0.65, max * 0.1);
  const size = max + 2 * pad;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return `${cx - size / 2} ${cy - size / 2} ${size} ${size}`;
}

export function makeMeasurer() {
  const measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  measureSvg.setAttribute('width', '1000');
  measureSvg.setAttribute('height', '1000');
  measureSvg.style.cssText =
    'position:fixed;left:-12000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none;overflow:visible';
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  measureSvg.append(group);
  document.body.append(measureSvg);
  return {
    measure(markup: string) {
      group.innerHTML = markup;
      group.querySelectorAll('.hit, .joint-hit').forEach((node) => node.remove());
      const b = group.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    destroy() {
      measureSvg.remove();
    },
  };
}

export const frameMarkup = (state: HandState) => `<g transform="rotate(${state.wrist})">${handMarkup(state)}</g>`;

export function buildSvgDocument(markup: string, viewBox: string, size = 1024): string {
  const css = `
    .bone { stroke: #9d4edd; stroke-width: 0.045; fill: #120e1a; }
    .buff { stroke: rgba(157, 78, 221, 0.45); stroke-width: 0.02; stroke-dasharray: 0.08, 0.08; fill: none; }
    .box { stroke: #adff2f; stroke-width: 0.035; stroke-dasharray: 0.1, 0.1; fill: none; }
    .child-joint { fill: #8b25e0; stroke: #7c3aed; stroke-width: 0.008; }
    .parent-joint { stroke: #166534; stroke-width: 0.004; }
    .wrist-sock { stroke: #ef4444; stroke-width: 0.04; fill: #120e1a; }
    .wrist-plug { fill: #ef4444; }
  `;
  const defs = `
    <defs>
      <radialGradient id="parentJointGrad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stop-color="#ffff33" />
        <stop offset="35%" stop-color="#adff2f" />
        <stop offset="70%" stop-color="#65a30d" />
        <stop offset="100%" stop-color="#15803d" />
      </radialGradient>
    </defs>
  `;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}"><style>${css}</style>${defs}${markup}</svg>`;
}

export async function canvasFromMarkup(
  markup: string,
  viewBox: string,
  size: number,
  opaque = false
): Promise<HTMLCanvasElement> {
  const blob = new Blob([buildSvgDocument(markup, viewBox, size)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Browser could not render export frame.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Cannot get 2D canvas context');
    if (opaque) {
      ctx.fillStyle = '#e2e2e8';
      ctx.fillRect(0, 0, size, size);
    }
    ctx.drawImage(image, 0, 0, size, size);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create image blob'))),
      type
    )
  );
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export interface SequenceResult {
  frames: { pose: HandState; markup: string }[];
  viewBox: string;
}

export async function buildSequence(
  from: Partial<HandState>,
  to: Partial<HandState>,
  count: number,
  onProgress?: (cur: number, tot: number) => void
): Promise<SequenceResult> {
  const measurer = makeMeasurer();
  const frames: { pose: HandState; markup: string }[] = [];
  let bounds: { x: number; y: number; width: number; height: number } | null = null;
  try {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 1 : i / (count - 1);
      const pose = interpolatePose(from, to, t);
      const markup = frameMarkup(pose);
      const b = measurer.measure(markup);
      if (!bounds) {
        bounds = { ...b };
      } else {
        const x = Math.min(bounds.x, b.x);
        const y = Math.min(bounds.y, b.y);
        const right = Math.max(bounds.x + bounds.width, b.x + b.width);
        const bottom = Math.max(bounds.y + bounds.height, b.y + b.height);
        bounds = { x, y, width: right - x, height: bottom - y };
      }
      frames.push({ pose, markup });
      if (i % 3 === 0 && onProgress) {
        onProgress(i + 1, count);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    measurer.destroy();
  }
  const vb = squareViewBox(bounds || { x: -4, y: -8, width: 8, height: 10 });
  return { frames, viewBox: vb };
}
