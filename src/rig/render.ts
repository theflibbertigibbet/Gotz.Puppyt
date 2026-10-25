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
    } else if (i === n - 1) {
      const r = w * 0.45;
      const l = -w / 2;
      const rt = w / 2;
      s2 += `<path class="bone" d="M ${l} ${bot} L ${l} ${top + r} A ${r} ${r} 0 0 1 ${l + r} ${top} L ${rt - r} ${top} A ${r} ${r} 0 0 1 ${rt} ${top + r} L ${rt} ${bot} Z"/>`;
    } else {
      s2 += `<rect class="bone" x="${-w / 2}" y="${yTop}" width="${w}" height="${yBot - yTop}" rx="0.04"/>`;
    }
    if (hit) {
      const boneJointIdx = i === n - 1 ? n - 1 : i;
      s2 += `<rect class="hit" x="${-w / 2 - 0.25}" y="${yTop - 0.25}" width="${w + 0.5}" height="${yBot - yTop + 0.5}" data-d="${d}" data-j="${boneJointIdx}"><title>${d} bone ${i}</title></rect>`;
      if (i === n - 1) {
        // Generous fingertip hit circle
        s2 += `<circle class="hit" cx="0" cy="${top}" r="0.42" data-d="${d}" data-j="${n - 1}"><title>${d} fingertip</title></circle>`;
      }
    }
    if (i + 1 < n) {
      const cj = st.cj[d][i] || 0;
      const turn = bendTurn(d, cj) || 0;
      s2 +=
        `<g transform="translate(0 ${top + J / 2})"><g transform="rotate(${turn})">${chain(d, i + 1)}<circle class="child-joint" r="0.05"/><circle class="parent-joint" r="0.03" fill="url(#parentJointGrad)"/>` +
        (hit ? `<circle class="hit" r="${Math.max(jr, 0.42)}" data-d="${d}" data-j="${i}"><title>${d} joint ${i}</title></circle>` : '') +
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
    `<circle class="wrist-sock" r="0.325"/>` +
    `<circle class="wrist-plug" r="0.1"/>` +
    (hit
      ? `<circle class="hit" cx="0" cy="0.18" r="0.28" data-w="1"><title>Wrist hub: drag to rotate the whole hand</title></circle>`
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
