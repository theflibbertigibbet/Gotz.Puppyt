export type Finger = 'index' | 'middle' | 'ring' | 'pinky' | 'thumb';
export type BuildType = 'standard' | 'claw' | 'trident' | 'mickey';

export interface HandState {
  expert: boolean;
  fullElasticity: boolean;
  splay: number;
  thumb: number;
  fs: {
    index: number;
    ring: number;
    pinky: number;
  };
  wrist: number;
  tilt: number;
  o: number; // knuckle overlap: 0.5 or 0
  wscale: boolean;
  boxes: boolean;
  skin: boolean;
  cj: {
    thumb: [number, number, number];
    index: [number, number, number];
    middle: [number, number, number];
    ring: [number, number, number];
    pinky: [number, number, number];
  };
  rot: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
  build: BuildType;
}

export const FINGER_ORDER: Finger[] = ['index', 'middle', 'ring', 'pinky', 'thumb'];
export const CONTROLS_FINGER_ORDER: Finger[] = ['index', 'ring', 'pinky', 'thumb', 'middle'];

export const BONES: Record<Finger, number[]> = {
  middle: [4, 2, 1, 1],
  ring: [3.75, 1.875, 0.9375, 0.9375],
  index: [3.75, 1.875, 0.9375, 0.9375],
  pinky: [3.5, 1.75, 0.875, 0.875],
  thumb: [2, 1, 1, 1],
};

export const SUM: Record<Finger, number> = {
  middle: 8,
  ring: 7.5,
  index: 7.5,
  pinky: 7,
  thumb: 5,
};

export const KN: Record<Finger, number> = {
  middle: 1,
  ring: 1,
  index: 1,
  pinky: 1,
  thumb: 0.5,
};

export const LIM: Record<Finger, number> = {
  thumb: -120,
  index: -30,
  middle: 0,
  ring: 30,
  pinky: 90,
};

export const BEND: Record<Finger, number> = {
  thumb: -1,
  index: 1,
  middle: 1,
  ring: 1,
  pinky: 1,
};

export const R = Math.PI / 180;

export const bendTurn = (d: Finger, cj: number) => -BEND[d] * cj;

export function norm(a: number): number {
  return ((a + 540) % 360) - 180;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function cRange(d: Finger, expert?: boolean): [number, number] {
  if (expert) return [-90, 90];
  return d === 'thumb' ? [-20, 80] : [-20, 90];
}

export function rRange(d: Finger, expert?: boolean, fullElasticity?: boolean): [number, number] {
  if (expert) return [-90, 90];
  if (fullElasticity) return d === 'thumb' ? [-60, 60] : [-45, 45];
  // Default: Anatomically constricted metacarpals bound to palm skin and fascia.
  // Middle is rigid anchor (±4°), Index is firm (±6°), Ring has subtle cupping (±8°),
  // Pinky is looser than the rest but firm and non-cartoony (±11°).
  // Thumb is the exception with saddle opposition freedom (±75°, 75% as tight as baseline).
  if (d === 'thumb') return [-75, 75];
  if (d === 'middle') return [-4, 4];
  if (d === 'index') return [-6, 6];
  if (d === 'ring') return [-8, 8];
  return [-11, 11]; // pinky
}

export function applyMetacarpalProgressiveStep(
  d: Finger,
  currentRot: number,
  dl: number,
  expert?: boolean
): number {
  if (expert) return clamp(currentRot + dl, -90, 90);

  // Anatomical functional limits constricted to palm skin & ligaments:
  const limit = d === 'thumb' ? 75 : d === 'middle' ? 4 : d === 'index' ? 6 : d === 'ring' ? 8 : 11;

  // Moving back toward neutral (0°) has low resistance
  const movingAway = Math.sign(dl) === Math.sign(currentRot) && Math.abs(currentRot) > 0.2;
  if (!movingAway) {
    return clamp(currentRot + dl * 0.5, -limit, limit);
  }

  // Moving away: rapid progressive resistance growing to functional stop
  const u = Math.min(1, Math.abs(currentRot) / limit);
  // High stiffness for fingers bound to palm skin:
  const complianceFactor = d === 'thumb' ? 0.65 : d === 'pinky' ? 0.18 : 0.08;
  const progressiveCompliance = Math.pow(Math.max(0, 1 - u * u), 2) * complianceFactor;

  const nextRot = currentRot + dl * progressiveCompliance;
  return clamp(nextRot, -limit, limit);
}

export function calcA(d: Finger, state: HandState): number {
  const extra = d === 'thumb' ? state.thumb : d === 'middle' ? 0 : state.fs[d] ?? 0;
  const effectiveSplay = clamp(state.splay + extra, -100, 100);
  return (LIM[d] * effectiveSplay) / 100 + state.tilt + (state.rot[d] ?? 0);
}

export function wid(d: Finger, wscale = false): number {
  const baseW = 0.75;
  const scale = d === 'thumb' ? 0.9 : SUM[d] / SUM.middle;
  const standardW = baseW * scale;
  if (wscale && d !== 'thumb') {
    return standardW * ((SUM[d] - KN[d]) / 7);
  }
  return standardW;
}

export function getBoneBox(d: Finger, i: number) {
  const bones = BONES[d];
  const len = bones[i];
  const scale = d === 'thumb' ? 1 : SUM[d] / SUM.middle;
  const boxW = 1 * scale;
  const emptyMargin = 0.125 * boxW;
  return {
    boxW,
    boxH: len,
    emptyMargin,
  };
}

export function reach(d: Finger, o: number): number {
  const knOvl = o > 0 ? KN[d] : 0;
  return SUM[d] - knOvl;
}

export function defaultState(): HandState {
  return {
    expert: false,
    fullElasticity: false,
    splay: 30,
    thumb: 10,
    fs: {
      index: 0,
      ring: 0,
      pinky: 0,
    },
    wrist: 0,
    tilt: 0,
    o: 0.5,
    wscale: false,
    boxes: false,
    skin: true,
    cj: {
      thumb: [0, 0, 0],
      index: [0, 0, 0],
      middle: [0, 0, 0],
      ring: [0, 0, 0],
      pinky: [0, 0, 0],
    },
    rot: {
      thumb: 0,
      index: 0,
      middle: 0,
      ring: 0,
      pinky: 0,
    },
    build: 'standard',
  };
}

export function cleanPose(raw: Partial<HandState> & Record<string, any>): Partial<HandState> {
  const res: any = {};
  if (raw.splay !== undefined) res.splay = clamp(Number(raw.splay) || 0, -100, 100);
  if (raw.thumb !== undefined) res.thumb = clamp(Number(raw.thumb) || 0, -100, 100);
  if (raw.wrist !== undefined) res.wrist = norm(Number(raw.wrist) || 0);
  if (raw.tilt !== undefined) res.tilt = clamp(Number(raw.tilt) || 0, -30, 30);
  if (raw.o !== undefined) res.o = Number(raw.o) > 0 ? 0.5 : 0;
  if (raw.wscale !== undefined) res.wscale = Boolean(raw.wscale);
  if (raw.boxes !== undefined) res.boxes = Boolean(raw.boxes);
  if (raw.skin !== undefined) res.skin = Boolean(raw.skin);
  if (raw.expert !== undefined) res.expert = Boolean(raw.expert);
  if (raw.fullElasticity !== undefined) res.fullElasticity = Boolean(raw.fullElasticity);
  if (raw.build !== undefined) res.build = raw.build;
  if (raw.fs) {
    res.fs = {
      index: clamp(Number(raw.fs.index) || 0, -100, 100),
      ring: clamp(Number(raw.fs.ring) || 0, -100, 100),
      pinky: clamp(Number(raw.fs.pinky) || 0, -100, 100),
    };
  }
  if (raw.rot) {
    res.rot = {
      thumb: Number(raw.rot.thumb) || 0,
      index: Number(raw.rot.index) || 0,
      middle: Number(raw.rot.middle) || 0,
      ring: Number(raw.rot.ring) || 0,
      pinky: Number(raw.rot.pinky) || 0,
    };
  }
  if (raw.cj) {
    res.cj = {
      thumb: [Number(raw.cj.thumb?.[0]) || 0, Number(raw.cj.thumb?.[1]) || 0, Number(raw.cj.thumb?.[2]) || 0],
      index: [Number(raw.cj.index?.[0]) || 0, Number(raw.cj.index?.[1]) || 0, Number(raw.cj.index?.[2]) || 0],
      middle: [Number(raw.cj.middle?.[0]) || 0, Number(raw.cj.middle?.[1]) || 0, Number(raw.cj.middle?.[2]) || 0],
      ring: [Number(raw.cj.ring?.[0]) || 0, Number(raw.cj.ring?.[1]) || 0, Number(raw.cj.ring?.[2]) || 0],
      pinky: [Number(raw.cj.pinky?.[0]) || 0, Number(raw.cj.pinky?.[1]) || 0, Number(raw.cj.pinky?.[2]) || 0],
    };
  }
  return res;
}

export function clampStateToLimits(st: HandState): HandState {
  const expert = st.expert;
  const fullElasticity = st.fullElasticity;
  const splay = clamp(st.splay, -100, 100);
  const thumb = clamp(st.thumb, -100, 100);
  const wrist = norm(st.wrist);
  const tilt = clamp(st.tilt, -30, 30);
  const fs = {
    index: clamp(st.fs.index, -100, 100),
    ring: clamp(st.fs.ring, -100, 100),
    pinky: clamp(st.fs.pinky, -100, 100),
  };
  const rot = { ...st.rot };
  const cj = {
    thumb: [...st.cj.thumb] as [number, number, number],
    index: [...st.cj.index] as [number, number, number],
    middle: [...st.cj.middle] as [number, number, number],
    ring: [...st.cj.ring] as [number, number, number],
    pinky: [...st.cj.pinky] as [number, number, number],
  };
  for (const d of FINGER_ORDER) {
    const [rLo, rHi] = rRange(d, expert, fullElasticity);
    rot[d] = clamp(rot[d], rLo, rHi);
    const [cLo, cHi] = cRange(d, expert);
    cj[d] = [
      clamp(cj[d][0], cLo, cHi),
      clamp(cj[d][1], cLo, cHi),
      clamp(cj[d][2], cLo, cHi),
    ];
  }
  return {
    ...st,
    fullElasticity,
    splay,
    thumb,
    wrist,
    tilt,
    fs,
    rot,
    cj,
  };
}

export interface JointPosition {
  x: number;
  y: number;
  phi: number;
}

export function jointPos(d: Finger, st: HandState): JointPosition[] {
  const bones = BONES[d];
  const n = bones.length;
  const knOvl = st.o > 0 ? KN[d] : 0;
  let phi = st.wrist + calcA(d, st);
  let x = 0;
  let y = 0;
  const pos: JointPosition[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i === 1 ? -knOvl / 2 : 0;
    const J = i === 0 ? knOvl : 0;
    const dist = a + bones[i] - J / 2;
    x += dist * Math.sin(phi * R);
    y -= dist * Math.cos(phi * R);
    pos.push({ x, y, phi });
    phi += bendTurn(d, st.cj[d]?.[i] ?? 0);
  }
  const lastBone = bones[n - 1];
  const tipX = x + lastBone * Math.sin(phi * R);
  const tipY = y - lastBone * Math.cos(phi * R);
  pos.push({ x: tipX, y: tipY, phi });
  return pos;
}

export function runIk(d: Finger, k: number, tx: number, ty: number, st: HandState): HandState {
  const nextSt: HandState = {
    ...st,
    rot: { ...st.rot },
    cj: {
      ...st.cj,
      [d]: [...st.cj[d]],
    },
  };
  const bones = BONES[d];
  const n = bones.length;
  // IK is always driven by the exact joint the user is grabbing (0: knuckle, 1: middle joint, 2: tip joint, 3: fingertip)
  const effIndex = Math.min(Math.max(0, k), n - 1);
  const [cLo, cHi] = cRange(d, nextSt.expert);
  const [rLo, rHi] = rRange(d, nextSt.expert, nextSt.fullElasticity);

  for (let iter = 0; iter < 14; iter++) {
    // Only joints upstream of the grabbed joint rotate towards target
    for (let j = effIndex - 1; j >= -1; j--) {
      const positions = jointPos(d, nextSt);
      const eff = positions[effIndex];
      let jx = 0;
      let jy = 0;
      if (j >= 0) {
        jx = positions[j].x;
        jy = positions[j].y;
      }
      const vEx = eff.x - jx;
      const vEy = eff.y - jy;
      const vTx = tx - jx;
      const vTy = ty - jy;
      const cross = vEx * vTy - vEy * vTx;
      const dot = vEx * vTx + vEy * vTy;
      if (Math.abs(dot) < 1e-6 && Math.abs(cross) < 1e-6) continue;
      const dl = Math.atan2(cross, dot) / R;

      if (j === -1) {
        // Metacarpal rotation
        if (nextSt.fullElasticity || nextSt.expert) {
          nextSt.rot[d] = clamp(nextSt.rot[d] + dl, rLo, rHi);
        } else {
          // Default mode: progressive resistance growing to functional stop
          nextSt.rot[d] = applyMetacarpalProgressiveStep(d, nextSt.rot[d], dl, nextSt.expert);
        }
      } else if (j >= 0 && j < 3) {
        nextSt.cj[d][j] = clamp(nextSt.cj[d][j] - BEND[d] * dl, cLo, cHi);
      }
    }
  }
  nextSt.rot[d] = Math.round(nextSt.rot[d]);
  nextSt.cj[d][0] = Math.round(nextSt.cj[d][0]);
  nextSt.cj[d][1] = Math.round(nextSt.cj[d][1]);
  nextSt.cj[d][2] = Math.round(nextSt.cj[d][2]);
  return nextSt;
}

export function getActiveFingers(build: BuildType = 'standard'): Finger[] {
  switch (build) {
    case 'claw':
      return ['index', 'thumb'];
    case 'trident':
      return ['middle', 'ring', 'thumb'];
    case 'mickey':
      return ['index', 'middle', 'ring', 'thumb'];
    case 'standard':
    default:
      return ['index', 'middle', 'ring', 'pinky', 'thumb'];
  }
}

export const PRESET_POSES: Record<string, Partial<HandState>> = {
  'Flat': {
    splay: 30,
    thumb: 10,
    wrist: 0,
    tilt: 0,
    fs: { index: 0, ring: 0, pinky: 0 },
    rot: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
    cj: {
      thumb: [0, 0, 0],
      index: [0, 0, 0],
      middle: [0, 0, 0],
      ring: [0, 0, 0],
      pinky: [0, 0, 0],
    },
  },
};
