import {
  Finger,
  HandState,
  BONES,
  KN,
  SUM,
  R,
  bendTurn,
  calcA,
  wid,
  getBoneBox,
  getActiveFingers,
  FINGER_ORDER,
} from './core.ts';
import { ART, ART_ORDER, ArtPart } from './art.ts';

export function bendMark(turn: number, cj: number): string {
  const r = 0.3;
  const a = turn * R;
  const dir = Math.sign(turn);
  const f = (n: number) => n.toFixed(3);
  const px = r * Math.sin(a);
  const py = -r * Math.cos(a);
  const tx = dir * Math.cos(a);
  const ty = dir * Math.sin(a);
  const head: [number, number][] = [
    [px + tx * 0.1, py + ty * 0.1],
    [px - ty * 0.055, py + tx * 0.055],
    [px + ty * 0.055, py - tx * 0.055],
  ];
  return `<g class="bend ${cj < 0 ? 'ext' : 'flex'}"><path d="M 0 ${f(-r)} A ${r} ${r} 0 ${Math.abs(turn) > 180 ? 1 : 0} ${turn > 0 ? 1 : 0} ${f(px)} ${f(py)}"/><path class="head" d="M ${head.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ')} Z"/></g>`;
}

export function boneSpan(d: Finger, i: number, o: number, skin = false) {
  const len = BONES[d][i];
  const ko = o > 0 ? KN[d] : 0;
  const a = i === 1 ? -ko / 2 : 0;
  const trim = d === 'thumb' && !skin ? 0 : ko / 2;
  const top = -(a + len);
  const bot = -a;
  return { top: i === 0 ? top + trim : top, bot: i === 1 ? bot - trim : bot };
}

export const ART_FOR: Record<Finger, ArtPart[]> = {
  thumb: ['proximal', 'middle', 'middle', 'distal'],
  index: ART_ORDER,
  middle: ART_ORDER,
  ring: ART_ORDER,
  pinky: ART_ORDER,
};

export function skinPath(part: ArtPart, yBase: number, len: number): string {
  const a = ART[part];
  const f = (v: number) => +v.toFixed(3);
  let d = `M ${f(a[0] * len)} ${f(yBase + a[1] * len)}`;
  for (let i = 2; i < a.length; i += 6) {
    d += ` C ${f(a[i] * len)} ${f(yBase + a[i + 1] * len)} ${f(a[i + 2] * len)} ${f(yBase + a[i + 3] * len)} ${f(a[i + 4] * len)} ${f(yBase + a[i + 5] * len)}`;
  }
  return d + ' Z';
}

export function structuralBonePath(d: Finger, i: number, yTop: number, yBot: number, w: number, n: number): string {
  const f = (v: number) => +v.toFixed(3);
  const h = Math.abs(yBot - yTop);
  if (i === n - 1) {
    // Distal tip segment with anatomical rounded dome arch
    const l = -w * 0.46;
    const r = w * 0.46;
    const lShaft = -w * 0.38;
    const rShaft = w * 0.38;
    const yMid = yTop + h * 0.5;
    const capR = w * 0.44;

    return (
      `M ${f(l)} ${f(yBot)} ` +
      `C ${f(l)} ${f(yBot - h * 0.2)} ${f(lShaft)} ${f(yMid + h * 0.1)} ${f(lShaft)} ${f(yMid)} ` +
      `C ${f(lShaft)} ${f(yTop + capR)} ${f(-capR)} ${f(yTop)} 0 ${f(yTop)} ` +
      `C ${f(capR)} ${f(yTop)} ${f(rShaft)} ${f(yTop + capR)} ${f(rShaft)} ${f(yMid)} ` +
      `C ${f(rShaft)} ${f(yMid + h * 0.1)} ${f(r)} ${f(yBot - h * 0.2)} ${f(r)} ${f(yBot)} Z`
    );
  } else {
    // Shaft bones (metacarpals, proximals, middle) with anatomical condyle flares & waist narrowing
    const l = -w * 0.46;
    const r = w * 0.46;
    const lMid = -w * 0.37;
    const rMid = w * 0.37;
    const lTop = -w * 0.44;
    const rTop = w * 0.44;
    const yMid = yTop + h * 0.5;

    return (
      `M ${f(l)} ${f(yBot)} ` +
      `C ${f(l)} ${f(yBot - h * 0.2)} ${f(lMid)} ${f(yMid + h * 0.1)} ${f(lMid)} ${f(yMid)} ` +
      `C ${f(lMid)} ${f(yMid - h * 0.1)} ${f(lTop)} ${f(yTop + h * 0.2)} ${f(lTop)} ${f(yTop)} ` +
      `L ${f(rTop)} ${f(yTop)} ` +
      `C ${f(rTop)} ${f(yTop + h * 0.2)} ${f(rMid)} ${f(yMid - h * 0.1)} ${f(rMid)} ${f(yMid)} ` +
      `C ${f(rMid)} ${f(yMid + h * 0.1)} ${f(r)} ${f(yBot - h * 0.2)} ${f(r)} ${f(yBot)} Z`
    );
  }
}

export function handMarkup(st: HandState, hit = false, bend = false): string {
  const chain = (d: Finger, i: number): string => {
    const B = BONES[d];
    const n = B.length;
    const ko = st.o > 0 ? KN[d] : 0;
    const w = wid(d, st.wscale);
    const len = B[i];
    const a = i === 1 ? -ko / 2 : 0;
    const J = i === 0 ? ko : 0;
    const top = -(a + len);
    const bot = -a;
    const sr = (d === 'thumb' ? 0.125 : 0.22) * (SUM[d] / 8);
    const jr = i === 0 ? KN[d] / 2 : sr;
    const { boxW, emptyMargin } = getBoneBox(d, i);
    let s2 = '';
    if (st.boxes) {
      s2 += `<rect class="box" x="${-boxW / 2}" y="${top}" width="${boxW}" height="${len}" stroke-dasharray="0.06 0.06"/>`;
      if (i === n - 1) {
        for (const x of [-boxW / 2 + emptyMargin, boxW / 2 - emptyMargin]) {
          s2 += `<line class="box" x1="${x}" y1="${top}" x2="${x}" y2="${bot}" stroke-opacity="0.45" stroke-dasharray="0.03 0.03"/>`;
        }
      }
    }
    const art = st.skin && i < ART_FOR[d].length;
    if (i > 0 && !art) {
      s2 += `<rect class="buff" x="${-w / 2}" y="${-sr}" width="${w}" height="${sr * 2}" rx="0.03"/>`;
    }
    const { top: yTop, bot: yBot } = boneSpan(d, i, st.o, st.skin);
    if (art) {
      s2 += `<path class="bone" d="${skinPath(ART_FOR[d][i], yBot, yBot - yTop)}"/>`;
    } else {
      s2 += `<path class="bone" d="${structuralBonePath(d, i, yTop, yBot, w, n)}"/>`;
    }
    if (hit) {
      const boneJointIdx = i;
      s2 += `<rect class="hit" x="${-w / 2 - 0.3}" y="${yTop - 0.25}" width="${w + 0.6}" height="${yBot - yTop + 0.5}" data-d="${d}" data-j="${boneJointIdx}"><title>${d} bone ${i}</title></rect>`;
      if (i === n - 1) {
        // Generous fingertip hit circle
        s2 += `<circle class="hit" cx="0" cy="${top}" r="0.5" data-d="${d}" data-j="3"><title>${d} fingertip</title></circle>`;
      }
    }
    if (i + 1 < n) {
      const cj = st.cj[d][i] || 0;
      const turn = bendTurn(d, cj) || 0;
      s2 +=
        `<g transform="translate(0 ${top + J / 2})"><g transform="rotate(${turn})">${chain(d, i + 1)}<circle class="child-joint" r="0.065"/><circle class="parent-joint" r="0.035"/><circle class="joint-center" r="0.015" fill="var(--fg)" opacity="0.8"/>` +
        (hit ? `<circle class="hit" r="${Math.max(jr * 1.8, 0.5)}" data-d="${d}" data-j="${i}"><title>${d} joint ${i}</title></circle>` : '') +
        `</g>` +
        (bend && cj ? bendMark(turn, cj) : '') +
        `</g>`;
    }
    return s2;
  };
  let s = st.boxes
    ? `<g class="box"><rect x="-2" y="-4" width="4" height="4"/><line x1="-1" y1="-4" x2="-1" y2="0"/><line x1="0" y1="-4" x2="0" y2="0"/><line x1="1" y1="-4" x2="1" y2="0"/></g>`
    : '';
  const active = getActiveFingers(st.build);

  // Render wrist socket and hit area BEHIND the fingers so fingers have top hit priority
  const wristBase =
    `<g class="wrist-group">` +
    `<path class="wrist-sock" d="M -0.45 0.35 C -0.5 0.1 -0.35 -0.15 0 -0.18 C 0.35 -0.15 0.5 0.1 0.45 0.35 C 0.3 0.42 -0.3 0.42 -0.45 0.35 Z"/>` +
    `<circle class="wrist-sock" r="0.32"/>` +
    `<circle class="wrist-plug" r="0.12"/>` +
    `<circle class="parent-joint" r="0.04" fill="var(--acc)"/>` +
    (hit
      ? `<circle class="hit" cx="0" cy="0.08" r="0.55" data-w="1"><title>Wrist hub: drag to rotate the whole hand</title></circle>`
      : '') +
    `</g>`;

  for (const d of FINGER_ORDER) {
    if (active.includes(d)) {
      s += `<g data-d="${d}" transform="rotate(${calcA(d, st)})">${chain(d, 0)}</g>`;
    }
  }

  // Fingers render after wristBase, ensuring fingers take precedence in DOM hit-testing
  return wristBase + s;
}
