import {
  HandState,
  Finger,
  BuildType,
  FINGER_ORDER,
  CONTROLS_FINGER_ORDER,
  PRESET_POSES,
  defaultState,
  cleanPose,
  clampStateToLimits,
  cRange,
  rRange,
  calcA,
  reach,
  norm,
  clamp,
  runIk,
  jointPos,
  getActiveFingers,
  R,
} from './core.ts';
import { handMarkup } from './render.ts';
import {
  interpolatePose,
  squareViewBox,
  makeMeasurer,
  frameMarkup,
  buildSvgDocument,
  canvasFromMarkup,
  canvasBlob,
  downloadBlob,
  buildSequence,
  gifFrame,
  gifIndices,
  gifHeader,
  encodeApng,
  compressPngPixels,
  zipStore,
} from './export.ts';

export interface FpsMode {
  id: string;
  name: string;
  fps: number;
  label: string;
  title: string;
}

export const FPS_MODES: FpsMode[] = [
  { id: 'brad', name: 'Brad', fps: 8, label: '8F', title: 'Brad mode (8 FPS cutout)' },
  { id: 'lotte', name: 'Lotte', fps: 12, label: '12F', title: 'Lotte mode (12 FPS Reiniger)' },
  { id: 'anime', name: 'Anime', fps: 15, label: '15F', title: 'Anime mode (15 FPS)' },
  { id: 'walt', name: 'Walt', fps: 24, label: '24F', title: 'Walt mode (24 FPS Golden Age)' },
  { id: 'pure', name: 'Pure', fps: 60, label: '60F', title: 'Pure mode (60 FPS Native)' },
];

export function mountGotzPuppyt(container: HTMLElement): () => void {
  const NEUTRAL = 'Flat';
  const STORE = 'gotz.puppyt.v2';
  const LEGACY = 'pyxl.hand.v2';
  const BUILDS: [BuildType, string, string][] = [
    ['standard', '5F', 'Full Hand'],
    ['claw', '2F', 'Claw'],
    ['trident', '3F', 'Trident'],
    ['mickey', '4F', "Mickey's Glove"],
  ];
  // Descriptive Hand Pose Language (Thumb - Index, Bird, Ring, Pinky):
  // | for straight (< 20°), \ for tilted (20°-60°), ] for square rotations (>= 60°)
  function digitSymbol(curlDeg: number): string {
    if (curlDeg < 20) return '|';
    if (curlDeg < 60) return '\\';
    return ']';
  }

  function getPoseLanguage(st: HandState): string {
    const avg = (d: Finger) => (st.cj[d][0] + st.cj[d][1] + st.cj[d][2]) / 3;
    const t = digitSymbol(avg('thumb'));
    const i = digitSymbol(avg('index'));
    const b = digitSymbol(avg('middle')); // Bird
    const r = digitSymbol(avg('ring'));
    const p = digitSymbol(avg('pinky'));
    return `${t} - ${i}${b}${r}${p}`;
  }

  const copy = <T>(o: T): T => structuredClone(o);
  const enc = (s: string) => new TextEncoder().encode(s);
  const el = (tag: string, a: Record<string, any> = {}, ...kids: (Node | string)[]) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(a)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };
  const btn = (label: string | Node, onclick?: (e: MouseEvent) => void, a: Record<string, any> = {}) =>
    el('button', { ...(onclick ? { onclick } : {}), ...a }, label);

  // Framerate state - Lotte 12 FPS default!
  let currentFpsMode: FpsMode = FPS_MODES[1]; // Lotte
  let currentFps = currentFpsMode.fps; // 12
  let frameInterval = 1000 / currentFps; // 83.33ms

  // Build the initial DOM skeleton inside the container with builds, framerate toggles, and timeline
  container.innerHTML = `
    <header>
      <b>Gotz.Puppyt</b><i>v2</i>
      <span class="seg" id="builds" title="Hand configuration"></span>
      <span class="seg" id="fps-modes" title="Framerate mode: Brad (8), Lotte (12), Anime (15), Walt (24), Pure (60)"></span>
      <span class="seg">
        <button class="u" id="hu" title="Undo (Ctrl+Z)">&lt;&lt;</button>
        <button class="r" id="hr" title="Redo (Ctrl+Y)">&gt;&gt;</button>
      </span>
      <span class="sp"></span>
      <button id="hq" title="Reference">[?]</button>
      <button id="th" title="Toggle dark / light">[SUN]</button>
    </header>
    <div id="stage">
      <svg id="s" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="parentJointGrad">
            <stop offset="0" stop-color="#ffff33"/>
            <stop offset=".35" stop-color="#adff2f"/>
            <stop offset=".7" stop-color="#65a30d"/>
            <stop offset="1" stop-color="#15803d"/>
          </radialGradient>
          <filter id="filmBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation=".0055"/>
          </filter>
        </defs>
        <g id="grid"></g>
        <g id="pose-base"></g>
        <g id="hand" filter="url(#filmBlur)"></g>
      </svg>
      <div id="toast" hidden></div>
      <div id="info"></div>
    </div>
    <div id="split" title="Drag to resize · double-click to reset"></div>
    <div id="c"></div>
    <div id="timeline">
      <div class="tl-left">
        <button id="tl-play" class="tl-btn" title="Play / Pause pose timeline">|&gt;</button>
        <button id="tl-loop" class="tl-btn on" title="Toggle loop">[LP]</button>
        <span id="tl-time" class="tl-time">0% · 0.00s</span>
        <span style="color:var(--mut);font-size:10px">FROM:</span>
        <select id="tl-from" class="tl-select"></select>
        <button id="tl-swap" class="tl-btn" title="Swap From and To poses" style="padding:0 5px">&lt;-&gt;</button>
        <span style="color:var(--mut);font-size:10px">TO:</span>
        <select id="tl-to" class="tl-select"></select>
      </div>

      <div class="tl-track-container" id="tl-track" title="Drag left/right to scrub · Drag up/down to set easing curve · Double-click to reset straight line">
        <svg class="tl-svg" id="tl-svg">
          <line class="tl-base-line" id="tl-guide" x1="14" y1="24" x2="300" y2="24" />
          <path class="tl-curve-line" id="tl-line" d="M 14 24 L 300 24" />
          <circle class="tl-node" id="tl-node-start" cx="14" cy="24" r="4.5" />
          <circle class="tl-node" id="tl-node-end" cx="300" cy="24" r="4.5" />
          <g id="tl-head-group">
            <circle class="tl-head-outer" id="tl-head" cx="14" cy="24" r="7" />
            <circle class="tl-head-inner" cx="14" cy="24" r="2.5" />
          </g>
        </svg>
        <div class="tl-tooltip" id="tl-tip" hidden>0% · LINEAR</div>
      </div>

      <div class="tl-right">
        <span id="tl-ease-badge" class="tl-badge" title="Click to reset to straight line (Linear)">[LINEAR]</span>
        <button id="tl-set-start" class="tl-btn" title="Pin current canvas pose as Start pose">[PIN S]</button>
        <button id="tl-set-end" class="tl-btn" title="Pin current canvas pose as End pose">[PIN E]</button>
      </div>
    </div>
    <div id="help" hidden>
      <div>
        <h3>Gotz.Puppyt Hand Rig v2</h3>
        <b>Drag on the canvas</b>
        <ul>
          <li><b>Red wrist hub:</b> rotate the whole hand.</li>
          <li><b>Finger root / base:</b> swing a finger about the wrist.</li>
          <li><b>Bone shaft or joint pin:</b> 14-pass CCD inverse kinematics toward the pointer.</li>
        </ul>
        <b>Descriptive Pose Language (Thumb - Index, Bird, Ring, Pinky)</b>
        <ul>
          <li><b>|</b> : Straight digit (&lt; 20° curl).</li>
          <li><b>\\</b> : Tilted digit (20°–60° curl).</li>
          <li><b>]</b> : Square rotation (≥ 60° bent / 90° square curl).</li>
          <li><b>Format:</b> <code>Thumb - Index, Bird, Ring, Pinky</code> (e.g. <code>|-||||</code> = flat, <code>]-]]]]</code> = fist, <code>]-|]]]</code> = pointing).</li>
        </ul>
        <b>Framerate Modes (Animation matches toggle everywhere)</b>
        <ul>
          <li><b>Brad (8 FPS):</b> Cutout animation, stepped cadence.</li>
          <li><b>Lotte (12 FPS):</b> Reiniger silhouette motion (Default).</li>
          <li><b>Anime (15 FPS):</b> Limited animation pacing.</li>
          <li><b>Walt (24 FPS):</b> Theatrical Golden Age animation.</li>
          <li><b>Pure (60 FPS):</b> Unthrottled native web framerate.</li>
        </ul>
        <b>Pose Timeline</b>
        <ul>
          <li><b>Straight line:</b> Represents linear progression from Start to End pose.</li>
          <li><b>Drag up/down:</b> Bends the line to set easing (Ease Out / In-Out up, Ease In down).</li>
          <li><b>Drag left/right:</b> Scrubs pose progression in real time.</li>
        </ul>
        <b>Builds</b>
        <ul>
          <li><b>Full</b> 5 digits · <b>Claw</b> index + thumb · <b>Trident</b> bird, ring, thumb · <b>Mickey's</b> no pinky.</li>
        </ul>
        <b>Space</b> saves the current pose as a numbered 1024×1024 PNG. Undo / redo: Ctrl+Z, Ctrl+Y / Cmd+Shift+Z.
        <p><button id="hx" class="on">[GOT IT]</button></p>
      </div>
    </div>
  `;

  const $ = <T extends HTMLElement | SVGElement>(s: string) => container.querySelector(s) as T;
  const svg = $<SVGSVGElement>('#s');
  const hand = $<SVGGElement>('#hand');
  const stage = $<HTMLDivElement>('#stage');

  let showBend = false;
  let S: HandState = defaultState();
  let sel = NEUTRAL;
  let hist: HandState[] = [copy(S)];
  let hi = 0;
  let anim = 0;
  let frozen = false;
  let preview: { orig: HandState; raf?: number } | null = null;
  let busy = false;
  const sync: (() => void)[] = [];

  const load = (): Record<string, any> => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? localStorage.getItem(LEGACY) ?? '{}');
    } catch {
      return {};
    }
  };
  const saved: Record<string, any> = load();
  let savedRev = 0;
  const persist = () => {
    savedRev++;
    try {
      localStorage.setItem(STORE, JSON.stringify(saved, null, 2));
    } catch {
      // storage unavailable
    }
  };

  const keep = (s: HandState) => ({
    expert: s.expert,
    fullElasticity: s.fullElasticity,
    o: s.o,
    wscale: s.wscale,
    boxes: s.boxes,
    skin: s.skin,
    build: s.build,
  });
  const isCustom = (k: string) => k in saved && !(k in PRESET_POSES);
  const poseState = (k: string): HandState => {
    const raw = PRESET_POSES[k] ?? saved[k];
    return raw ? clampStateToLimits({ ...defaultState(), ...cleanPose(raw), ...keep(S) }) : copy(S);
  };
  const same = (a: HandState, b: HandState) => JSON.stringify(cleanPose(a)) === JSON.stringify(cleanPose(b));

  let tt: any;
  const toast = (m: string, ms = 1800) => {
    const t = $<HTMLDivElement>('#toast');
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(tt);
    tt = setTimeout(() => {
      t.hidden = true;
    }, ms);
  };

  const updHist = () => {
    container.querySelectorAll<HTMLButtonElement>('.u').forEach((b) => (b.disabled = hi <= 0));
    container.querySelectorAll<HTMLButtonElement>('.r').forEach((b) => (b.disabled = hi >= hist.length - 1));
  };

  function commit(s = S) {
    if (same(hist[hi], s)) return;
    hist = hist.slice(0, hi + 1);
    hist.push(copy(s));
    if (hist.length > 60) hist.shift();
    hi = hist.length - 1;
    updHist();
  }

  function glide(target: HandState, ms = 320) {
    cancelAnimationFrame(anim);
    const from = copy(S);
    const t0 = performance.now();
    let lastGlideTick = 0;
    const tick = (now: number) => {
      if (currentFps >= 60 || now - lastGlideTick >= frameInterval) {
        lastGlideTick = now;
        const p = Math.min(1, (now - t0) / ms);
        S = p < 1 ? interpolatePose(from, target, 0.5 - 0.5 * Math.cos(p * Math.PI)) : copy(target);
        draw();
      }
      if (performance.now() - t0 < ms) {
        anim = requestAnimationFrame(tick);
      } else {
        S = copy(target);
        draw();
      }
    };
    anim = requestAnimationFrame(tick);
  }

  const apply = (t: HandState, ms = 320, msg?: string) => {
    commit(t);
    glide(t, ms);
    if (msg) toast(msg);
  };

  const stepHist = (d: number) => {
    const i = hi + d;
    if (i < 0 || i >= hist.length) return;
    hi = i;
    updHist();
    glide(hist[hi]);
    toast(d < 0 ? 'Undo' : 'Redo', 1200);
  };

  const applyPose = (k: string) => {
    sel = k;
    apply(poseState(k));
    refresh();
  };

  function savePose(quick: boolean) {
    let defaultName = $name.value.trim();
    if (!defaultName) {
      let i = 1;
      while (saved['Pose ' + i]) i++;
      defaultName = 'Pose ' + i;
    }
    const inputName = prompt('Enter name for saved pose:', defaultName);
    if (inputName === null) return; // User canceled
    const n = inputName.trim() || defaultName;
    saved[n] = cleanPose(S);
    persist();
    sel = n;
    $name.value = '';
    refresh();
    toast(`Saved "${n}"`, 2200);
  }

  function delPose() {
    if (!isCustom(sel)) return toast('Cannot delete default or preset poses', 2200);
    const n = sel;
    delete saved[n];
    persist();
    applyPose(NEUTRAL);
    toast(`Deleted "${n}"`, 2200);
  }

  function mirror() {
    const t = copy(S);
    t.wrist = norm(-t.wrist);
    for (const k of ['splay', 'thumb', 'tilt'] as const) t[k] = -t[k];
    for (const d of FINGER_ORDER) t.rot[d] = -t.rot[d];
    for (const d in t.fs) (t.fs as any)[d] = -(t.fs as any)[d];
    apply(t, 350, 'Mirrored');
  }

  function curl(dl: number) {
    const t = copy(S);
    for (const d of FINGER_ORDER) {
      const [lo, hi2] = cRange(d, t.expert);
      t.cj[d] = t.cj[d].map((v) => clamp(v + dl, lo, hi2)) as [number, number, number];
    }
    apply(t, 220, dl > 0 ? `Curled +${dl}\xB0` : `Extended ${dl}\xB0`);
  }

  function shuffle() {
    const t = copy(S);
    const rnd = (n: number) => Math.floor(Math.random() * n);
    for (const d of FINGER_ORDER) {
      const [cl, ch] = cRange(d, t.expert);
      const [rl, rh] = rRange(d, t.expert);
      const b = rnd(ch - cl) + cl;
      t.cj[d] = [0, 1, 2].map(() => clamp(b + rnd(20) - 10, cl, ch)) as [number, number, number];
      t.rot[d] = clamp(Math.round(rnd((rh - rl) * 0.5) + rl * 0.25), rl, rh);
    }
    t.splay = clamp(rnd(60) - 20, -50, 70);
    apply(t, 320, 'Randomized natural gesture');
  }

  function setBuild(id: BuildType) {
    S.build = id;
    commit();
    draw();
  }

  const cycleBuild = () => {
    const b = BUILDS[(BUILDS.findIndex((x) => x[0] === S.build) + 1) % 4];
    setBuild(b[0]);
    toast('Build: ' + b[2], 2000);
  };

  // FPS Mode controller
  function setFpsMode(id: string) {
    const found = FPS_MODES.find((m) => m.id === id);
    if (!found) return;
    currentFpsMode = found;
    currentFps = found.fps;
    frameInterval = currentFps >= 60 ? 0 : 1000 / currentFps;

    // Keep animation flyout select in sync
    if ($fps) $fps.value = String(currentFps);

    sync.forEach((f) => f());
    toast(`Framerate: ${found.name} (${found.fps} FPS)`, 1800);
  }

  const cycleFpsMode = () => {
    const idx = FPS_MODES.findIndex((m) => m.id === currentFpsMode.id);
    const next = FPS_MODES[(idx + 1) % FPS_MODES.length];
    setFpsMode(next.id);
  };

  const reset = () => {
    sel = NEUTRAL;
    apply(poseState(NEUTRAL), 320, 'Reset to Flat');
    refresh();
  };

  const poseBase = $<SVGGElement>('#pose-base');

  function draw() {
    if (poseBase) {
      poseBase.setAttribute('transform', `rotate(${S.wrist})`);
      poseBase.innerHTML = `<line class="pose-base-line" x1="-14" y1="0" x2="14" y2="0"/><title>Pose base line (X-axis base orientation)</title>`;
    }
    hand.setAttribute('transform', `rotate(${S.wrist})`);
    hand.innerHTML = handMarkup(S, true, showBend);
    sync.forEach((f) => f());
    if (!frozen) fit();
  }

  function fit() {
    const bb = hand.getBBox();
    const r = stage.getBoundingClientRect();
    const asp = Math.max(0.2, (r.width || 800) / (r.height || 500));
    const bh = 10.5;
    const dw = asp >= 1 ? bh * asp : bh;
    const dh = asp >= 1 ? bh : bh / asp;
    const dy = 1.3 - dh;
    let v = [-dw / 2, dy, dw, dh];
    if (bb.width > 0 && bb.height > 0) {
      const c = Math.cos(S.wrist * R);
      const s = Math.sin(S.wrist * R);
      const bottom = Math.max(
        ...[bb.x, bb.x + bb.width].flatMap((x) => [bb.y, bb.y + bb.height].map((y) => x * s + y * c))
      );
      if (bottom > 1.3) {
        const h = Math.max(dh, bottom + 0.6 - dy);
        const w = asp >= 1 ? h * asp : h;
        v = [-w / 2, dy, w, h];
      }
    }
    svg.setAttribute('viewBox', v.join(' '));
  }

  const gridEl = $<SVGGElement>('#grid');
  if (gridEl) {
    gridEl.innerHTML = Array.from({ length: 29 }, (_, i) => i - 14)
      .map(
        (n) =>
          `<line class="${n ? 'g-unit' : 'axis'}" x1="${n}" y1="-14" x2="${n}" y2="14"/><line class="${
            n ? 'g-unit' : 'axis'
          }" x1="-14" y1="${n}" x2="14" y2="${n}"/>`
      )
      .join('');
  }

  let drag: any = null;
  let inv: DOMMatrix | null = null;
  let lastDragTime = 0;
  let dragPendingCoords: { clientX: number; clientY: number } | null = null;
  let dragTimer: any = null;

  function processDrag(clientX: number, clientY: number) {
    if (!drag || !inv) return;
    const { x, y } = new DOMPoint(clientX, clientY).matrixTransform(inv);
    const a = Math.atan2(x, -y) / R;
    if (drag.w) {
      S.wrist = Math.round(norm(a));
    } else if (drag.f) {
      const d = drag.d as Finger;
      const [lo, hi2] = rRange(d, S.expert);
      S.rot[d] = Math.round(clamp(norm(a - (S.wrist + calcA(d, S) - S.rot[d])), lo, hi2));
    } else {
      S = runIk(drag.d as Finger, drag.k, x, y, S);
    }
    draw();
  }

  type FingerTab = Finger | 'all';
  let activeTab: FingerTab = 'index';

  const FINGER_TABS: { id: FingerTab; label: string }[] = [
    { id: 'index', label: 'Index' },
    { id: 'middle', label: 'Bird' },
    { id: 'ring', label: 'Ring' },
    { id: 'pinky', label: 'Pinky' },
    { id: 'thumb', label: 'Thumb' },
    { id: 'all', label: 'All' },
  ];

  const fingerGroupEls: Partial<Record<Finger, HTMLElement>> = {};
  const tabButtons: Record<string, HTMLButtonElement> = {};

  let $menuLabel: HTMLElement | null = null;
  let $menuReach: HTMLElement | null = null;

  interface ToggleBox {
    container: HTMLElement;
    btn: HTMLButtonElement;
    wrapper: HTMLElement;
    range: HTMLInputElement;
    num: HTMLElement;
    isOpen: () => boolean;
    open: () => void;
    close: () => void;
    update: (val: number, rangeLo: number, rangeHi: number) => void;
  }

  let toggleBoxes: ToggleBox[] = [];
  let tglBoxMeta: ToggleBox | null = null;
  let tglBoxFinger: ToggleBox | null = null;
  let tglBoxGrip: ToggleBox | null = null;
  let tglBoxTip: ToggleBox | null = null;

  function createRotationToggleBox(
    type: 'meta' | 'finger' | 'grip' | 'tip',
    label: string
  ): ToggleBox {
    const container = el('div', { class: 'rot-tgl-box' });
    const btn = el(
      'button',
      { class: 'rot-tgl-btn', title: `Click to open live slider for ${label}` },
      `${label}: 0\xB0`
    ) as HTMLButtonElement;

    const nameSpan = el('span', { class: 'rot-tgl-name' }, label);
    const range = el('input', { type: 'range', class: 'rot-tgl-range' }) as HTMLInputElement;
    const num = el('span', { class: 'rot-tgl-num' }, '0\xB0');
    const closeBtn = el('button', { class: 'rot-tgl-x', title: 'Close slider' }, '\xD7');

    const wrapper = el('div', { class: 'rot-tgl-slider-wrapper', hidden: '' }, nameSpan, range, num, closeBtn);
    container.append(btn, wrapper);

    let openState = false;

    const open = () => {
      openState = true;
      btn.hidden = true;
      wrapper.hidden = false;
      range.focus();
    };

    const close = () => {
      openState = false;
      wrapper.hidden = true;
      btn.hidden = false;
    };

    btn.onclick = () => {
      toggleBoxes.forEach((tb) => {
        if (tb.container !== container) tb.close();
      });
      open();
    };

    closeBtn.onclick = () => close();

    let userDragging = false;
    range.onpointerdown = () => {
      userDragging = true;
    };
    range.onpointerup = range.onpointercancel = () => {
      userDragging = false;
      commit();
    };

    range.oninput = () => {
      const v = Number(range.value) || 0;
      num.textContent = `${Math.round(v)}\xB0`;

      const targets = activeTab === 'all' ? getActiveFingers(S.build) : [activeTab as Finger];
      targets.forEach((f) => {
        if (type === 'meta') {
          const [lo, hi2] = rRange(f, S.expert, S.fullElasticity);
          S.rot[f] = clamp(v, lo, hi2);
        } else {
          const jIdx = type === 'finger' ? 0 : type === 'grip' ? 1 : 2;
          const [lo, hi2] = cRange(f, S.expert);
          S.cj[f][jIdx] = clamp(v, lo, hi2);
        }
      });
      draw();
    };

    const tb: ToggleBox = {
      container,
      btn,
      wrapper,
      range,
      num,
      isOpen: () => openState,
      open,
      close,
      update: (val: number, rangeLo: number, rangeHi: number) => {
        btn.textContent = `${label}: ${Math.round(val)}\xB0`;
        range.min = String(rangeLo);
        range.max = String(rangeHi);
        if (!userDragging && document.activeElement !== range) {
          range.value = String(val);
          num.textContent = `${Math.round(val)}\xB0`;
        }
      },
    };
    toggleBoxes.push(tb);
    return tb;
  }

  function updateTopHeaderAndToggles() {
    const target = activeTab;
    const active = getActiveFingers(S.build);

    if (target === 'all') {
      if ($menuLabel) $menuLabel.textContent = 'ALL FINGERS';
      if ($menuReach) $menuReach.textContent = 'Reach: 5.0 - 8.0 pyxls';
    } else {
      const labelText = target === 'middle' ? 'BIRD' : target.toUpperCase();
      if ($menuLabel) $menuLabel.textContent = labelText;
      if ($menuReach) $menuReach.textContent = `Reach: ${reach(target, S.o)} pyxls`;
    }

    const targets = target === 'all' ? active : [target as Finger];
    const firstTarget = targets[0] ?? 'index';

    const avgRot = targets.reduce((acc, f) => acc + (S.rot[f] ?? 0), 0) / (targets.length || 1);
    const avgJ0 = targets.reduce((acc, f) => acc + (S.cj[f]?.[0] ?? 0), 0) / (targets.length || 1);
    const avgJ1 = targets.reduce((acc, f) => acc + (S.cj[f]?.[1] ?? 0), 0) / (targets.length || 1);
    const avgJ2 = targets.reduce((acc, f) => acc + (S.cj[f]?.[2] ?? 0), 0) / (targets.length || 1);

    const [rLo, rHi] = rRange(firstTarget, S.expert, S.fullElasticity);
    const [cLo, cHi] = cRange(firstTarget, S.expert);

    if (tglBoxMeta) tglBoxMeta.update(avgRot, rLo, rHi);
    if (tglBoxFinger) tglBoxFinger.update(avgJ0, cLo, cHi);
    if (tglBoxGrip) tglBoxGrip.update(avgJ1, cLo, cHi);
    if (tglBoxTip) tglBoxTip.update(avgJ2, cLo, cHi);
  }

  function updateFingerTabs() {
    for (const [id, b] of Object.entries(tabButtons)) {
      b.classList.toggle('on', id === activeTab);
    }
    for (const d of FINGER_ORDER) {
      const card = fingerGroupEls[d];
      if (card) {
        card.style.display = activeTab === 'all' || activeTab === d ? '' : 'none';
      }
    }
    updateTopHeaderAndToggles();
  }

  svg.onpointerdown = (e: PointerEvent) => {
    if (preview) return;
    inv = svg.getScreenCTM()?.inverse() ?? null;
    if (!inv) return;

    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    const t = e.target as HTMLElement;
    const ds = t.dataset;
    const g = t.closest?.('[data-d]') as HTMLElement | null;

    // Better click detection so IK is always driven by the exact joint the user is grabbing:
    // 1. Calculate proximity to all joints and fingertips across active fingers:
    const active = getActiveFingers(S.build);
    let bestDist = Infinity;
    let bestFinger: Finger | null = null;
    let bestJoint = 3;

    for (const d of active) {
      const positions = jointPos(d, S); // [0: knuckle, 1: middle joint, 2: tip joint, 3: fingertip]
      positions.forEach((pos, idx) => {
        const dist = Math.hypot(pt.x - pos.x, pt.y - pos.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestFinger = d;
          bestJoint = idx;
        }
      });
    }

    if (ds.d && ds.j !== undefined) {
      // User directly clicked a joint pin or bone segment
      drag = { d: ds.d as Finger, k: +ds.j };
    } else if (bestDist < 1.35 && bestFinger) {
      // User clicked close to a joint or fingertip: drive that exact joint!
      drag = { d: bestFinger, k: bestJoint };
    } else if (g && g.dataset.d) {
      drag = { d: g.dataset.d as Finger, k: bestJoint };
    } else if (ds.w) {
      // Only whole hand rotate if wrist hub was explicitly clicked and no finger was nearby
      drag = { w: 1 };
    } else {
      drag = null;
    }

    if (!drag) return;
    if (drag.d && activeTab !== 'all') {
      activeTab = drag.d as FingerTab;
      updateFingerTabs();
    }
    frozen = true;
    cancelAnimationFrame(anim);
    svg.setPointerCapture(e.pointerId);
    lastDragTime = performance.now();
  };

  // Dragging framerate strictly follows the active FPS toggle!
  svg.onpointermove = (e: PointerEvent) => {
    if (!drag || !inv) return;
    const now = performance.now();
    dragPendingCoords = { clientX: e.clientX, clientY: e.clientY };

    if (currentFps >= 60) {
      // Pure mode: immediate smooth RAF processing
      processDrag(e.clientX, e.clientY);
    } else if (now - lastDragTime >= frameInterval) {
      lastDragTime = now;
      if (dragTimer) {
        clearTimeout(dragTimer);
        dragTimer = null;
      }
      processDrag(e.clientX, e.clientY);
    } else if (!dragTimer) {
      const remaining = Math.max(0, frameInterval - (now - lastDragTime));
      dragTimer = setTimeout(() => {
        dragTimer = null;
        lastDragTime = performance.now();
        if (dragPendingCoords && drag) {
          processDrag(dragPendingCoords.clientX, dragPendingCoords.clientY);
        }
      }, remaining);
    }
  };

  svg.onpointerup = svg.onpointercancel = () => {
    if (!drag) return;
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }
    if (dragPendingCoords) {
      processDrag(dragPendingCoords.clientX, dragPendingCoords.clientY);
      dragPendingCoords = null;
    }
    drag = null;
    frozen = !!preview;
    commit();
    fit();
  };

  const splitEl = $<HTMLDivElement>('#split');
  if (splitEl) {
    splitEl.onpointerdown = () => {
      const mv = (e: PointerEvent) => {
        stage.style.height = clamp((e.clientY / innerHeight) * 100, 20, 80) + '%';
        fit();
      };
      const up = () => {
        window.removeEventListener('pointermove', mv as any);
        window.removeEventListener('pointerup', up as any);
      };
      window.addEventListener('pointermove', mv as any);
      window.addEventListener('pointerup', up as any);
    };
    splitEl.ondblclick = () => {
      stage.style.height = '66.667%';
      fit();
    };
  }

  const onResize = () => {
    if (!frozen) fit();
    renderTimeline();
  };
  window.addEventListener('resize', onResize);

  const typing = (t: HTMLElement) =>
    /^(textarea|select)$/i.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|button)$/.test((t as HTMLInputElement).type));
  const spaceKey = (e: KeyboardEvent) =>
    e.code === 'Space' &&
    !typing(e.target as HTMLElement) &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    $<HTMLDivElement>('#help')?.hidden;

  const onKeyDown = (e: KeyboardEvent) => {
    if (spaceKey(e)) {
      e.preventDefault();
      if (e.repeat) return;
      if ((e.target as HTMLElement).tagName === 'BUTTON') (e.target as HTMLElement).blur();
      snapPng();
      return;
    }
    if (/^(input|textarea|select)$/i.test((e.target as HTMLElement).tagName) || !(e.ctrlKey || e.metaKey) || e.altKey)
      return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      stepHist(k === 'y' || e.shiftKey ? 1 : -1);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (spaceKey(e)) e.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function slider(
    label: string,
    unit: string,
    range: () => [number, number],
    get: () => number,
    set: (v: number) => void
  ) {
    const r = el('input', { type: 'range' }) as HTMLInputElement;
    const n = el('input', { type: 'number' }) as HTMLInputElement;
    const put = (v: string | number) => {
      const [lo, hi2] = range();
      set(clamp(Number(v) || 0, lo, hi2));
      draw();
    };
    r.oninput = () => put(r.value);
    n.oninput = () => put(n.value);
    r.onchange = n.onchange = () => commit();
    sync.push(() => {
      const [lo, hi2] = range();
      const v = get();
      for (const i of [r, n]) {
        i.min = String(lo);
        i.max = String(hi2);
        if (document.activeElement !== i) i.value = String(v);
      }
    });
    return el('div', { class: 'row' }, el('label', {}, label), r, n, el('span', { class: 'u' }, unit));
  }

  function check(label: string, note: string, get: () => boolean, set: (v: boolean) => void) {
    const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
    c.onchange = () => {
      set(c.checked);
      draw();
      commit();
    };
    sync.push(() => (c.checked = get()));
    return el('label', { class: 'chk' }, c, label, el('small', {}, note));
  }

  const flies: Record<string, HTMLElement> = {};
  function fly(id: string, side: 'l' | 'r', title: string, ...kids: (Node | string)[]) {
    const f = el(
      'div',
      { class: `fly ${side}`, hidden: '' },
      el('h2', {}, title, btn('[X]', () => show(id))),
      ...kids
    ) as HTMLElement;
    flies[id] = f;
    stage.append(f);
    return f;
  }

  function show(id: string) {
    const open = flies[id].hidden;
    for (const f of Object.values(flies)) f.hidden = true;
    flies[id].hidden = !open;
    sync.forEach((f) => f());
  }

  const tbtn = (label: string | Node, title: string, fn?: (e: MouseEvent) => void, a: Record<string, any> = {}) =>
    btn(label, fn, { title, ...a });

  const section = (title: string, icon: string, open: boolean, ...kids: (Node | string)[]) => {
    const d = el(
      'details',
      { class: 'sec' },
      el('summary', {}, `${icon} ${title}`, el('small', { class: 'bdg', hidden: '' }), el('i', { class: 'chev' }, 'v')),
      el('div', { class: 'col' }, ...kids)
    ) as HTMLDetailsElement;
    d.open = open;
    return d;
  };

  const badge = (d: HTMLElement, n?: string | number) => {
    const b = d.querySelector('.bdg') as HTMLElement;
    if (b) {
      b.textContent = n !== undefined ? String(n) : '';
      b.hidden = n === undefined;
    }
  };

  const $name = el('input', { type: 'text', placeholder: 'Pose name (empty = auto #)' }) as HTMLInputElement;
  const $q = el('input', { type: 'text', placeholder: 'Search poses\u2026' }) as HTMLInputElement;
  let cat = 'all';
  const $presets = el('div', { class: 'pl' });
  const $mine = el('div', { class: 'pl' });
  const $json = el('textarea', { placeholder: 'Paste JSON pose or click Export JSON\u2026' }) as HTMLTextAreaElement;
  const chips = ['all', 'presets', 'saved'].map((c) =>
    btn(
      (c === 'all' ? 'All' : c === 'presets' ? 'Canonical' : 'Custom') as string,
      () => {
        cat = c;
        refresh();
      },
      { 'data-c': c }
    )
  );
  const selMorph = el('select') as HTMLSelectElement;
  const selFrom = el('select') as HTMLSelectElement;
  const selTo = el('select') as HTMLSelectElement;
  const $del = btn('Delete', delPose) as HTMLButtonElement;
  const secMine = section(
    'User Saved Poses',
    '[*]',
    true,
    $mine,
    el('div', { class: 'r2' }, $name, btn('Save', () => savePose(false)), $del)
  );

  const tlFromSelect = $<HTMLSelectElement>('#tl-from');
  const tlToSelect = $<HTMLSelectElement>('#tl-to');

  const $quickList = el('div', { class: 'col', style: 'gap:6px' });

  function refresh() {
    const t = $q.value.trim().toLowerCase();
    const hit = (k: string) => !t || k.toLowerCase().includes(t);
    const fill = (box: HTMLElement, keys: string[], empty: string, cls: string) => {
      const ks = keys.filter(hit);
      box.replaceChildren(
        ...ks.map((k) => {
          const p = poseState(k);
          const lang = getPoseLanguage(p);
          const row = el(
            'div',
            { class: 'pose-row' },
            el('span', { class: 'pose-txt' }, k),
            el('span', { class: 'pose-code' }, lang)
          );
          return btn(row, () => applyPose(k), {
            class: 'pose' + cls + (k === sel ? ' on' : ''),
            title: `${k} (Thumb - Index, Bird, Ring, Pinky: ${lang})`,
          });
        })
      );
      if (!ks.length) box.textContent = empty;
      return ks.length;
    };
    fill($presets, cat === 'saved' ? [] : Object.keys(PRESET_POSES), 'No matching presets', '');
    badge(
      secMine,
      fill(
        $mine,
        cat === 'presets' ? [] : Object.keys(saved),
        Object.keys(saved).length ? 'No matching poses' : 'No user poses saved yet',
        ' me'
      )
    );
    chips.forEach((b) => b.classList.toggle('on', b.dataset.c === cat));

    const allPoses = [
      ...Object.keys(PRESET_POSES),
      ...Object.keys(saved),
    ];
    $quickList.replaceChildren(
      ...allPoses.map((k) => {
        const lang = getPoseLanguage(poseState(k));
        const btnLabel = k.length > 8 ? k.slice(0, 7) + '\u2026' : k;
        return tbtn(btnLabel, `${k} (Thumb - Index, Bird, Ring, Pinky: ${lang})`, () => applyPose(k), {
          class: k === sel ? 'on' : '',
          'data-q': k,
        });
      })
    );

    const allDropdowns = [selMorph, selFrom, selTo, tlFromSelect, tlToSelect].filter(Boolean) as HTMLSelectElement[];
    for (const s of allDropdowns) {
      const v = s.value;
      s.replaceChildren(
        ...[
          ['Presets', Object.keys(PRESET_POSES)],
          ['Saved', Object.keys(saved)],
        ]
          .filter((g) => (g[1] as string[]).length)
          .map(([l, ks]) =>
            el('optgroup', { label: l as string }, ...(ks as string[]).map((k) => el('option', { value: k }, k)))
          )
      );
      s.value = [...s.options].some((o) => o.value === v)
        ? v
        : s === selMorph || s === selTo || s === tlToSelect
        ? (Object.keys(saved)[0] ?? NEUTRAL)
        : NEUTRAL;
    }
    container.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === sel));
    $del.disabled = !isCustom(sel);
    renderTimeline();
  }
  $q.oninput = refresh;

  fly(
    'lib',
    'l',
    'Pose Library',
    $q,
    el('div', { class: 'r2' }, ...chips),
    section('Quick Pose Presets', '[P]', true, $presets),
    secMine,
    section(
      'JSON Pose Data',
      '{}',
      false,
      el(
        'div',
        { class: 'r2' },
        btn('Export JSON', () => ($json.value = JSON.stringify(cleanPose(S), null, 2))),
        btn('Import JSON', () => {
          try {
            apply(
              clampStateToLimits({ ...defaultState(), ...cleanPose(JSON.parse($json.value)), ...keep(S) }),
              320,
              'Pose JSON loaded'
            );
          } catch {
            toast('Invalid JSON pose data', 2500);
          }
        })
      ),
      $json
    )
  );

  let morphBase: HandState | null = null;
  let morphAmt = 0;
  const $mv = el('span', {}, '0%');
  const $mr = el('input', {
    type: 'range',
    min: 0,
    max: 100,
    value: 0,
    style: 'width:100%;accent-color:var(--acc)',
  }) as HTMLInputElement;

  const morphZero = () => {
    morphBase = null;
    $mr.value = '0';
    morphAmt = 0;
    $mv.textContent = '0%';
  };
  $mr.oninput = () => {
    if (!morphAmt) morphBase = copy(S);
    morphAmt = +$mr.value;
    $mv.textContent = morphAmt + '%';
    if (morphBase) {
      S = interpolatePose(morphBase, poseState(selMorph.value), morphAmt / 100);
      draw();
    }
  };
  selMorph.onchange = morphZero;

  const avgCurl = () => Math.round((['index', 'middle', 'ring', 'pinky'] as Finger[]).reduce((n, d) => n + S.cj[d][0], 0) / 4);

  fly(
    'morph',
    'l',
    'Live Pose Morph',
    section(
      'Target Pose & Morph Scrub',
      '[~]',
      true,
      el('label', {}, 'Target pose'),
      selMorph,
      el('div', { class: 'r2' }, el('span', {}, 'Morph amount'), $mv),
      $mr,
      el(
        'div',
        { class: 'r2' },
        btn('Commit morph', () => {
          commit();
          morphZero();
          toast('Morph applied');
        }),
        btn('Reset', () => {
          morphZero();
          reset();
        })
      )
    ),
    section(
      'Master Rig Controls',
      '[!]',
      false,
      slider(
        'All curl',
        '\xB0',
        () => [-20, 90],
        avgCurl,
        (v) => {
          for (const d of FINGER_ORDER) {
            const c = clamp(v, ...cRange(d, S.expert));
            S.cj[d] = [c, c, c];
          }
        }
      ),
      slider(
        'Hand splay',
        '%',
        () => [-100, 100],
        () => S.splay,
        (v) => (S.splay = v)
      ),
      slider(
        'Wrist',
        '\xB0',
        () => [-180, 180],
        () => S.wrist,
        (v) => (S.wrist = v)
      )
    )
  );

  fly(
    'rig',
    'r',
    'Hand Rig',
    section(
      'Hand Angles & Splay',
      '[!]',
      false,
      slider(
        'Wrist',
        '\xB0',
        () => [-180, 180],
        () => S.wrist,
        (v) => (S.wrist = v)
      ),
      slider(
        'Hand splay',
        '%',
        () => [-100, 100],
        () => S.splay,
        (v) => (S.splay = v)
      ),
      slider(
        'Bird tilt',
        '\xB0',
        () => [-30, 30],
        () => S.tilt,
        (v) => (S.tilt = v)
      )
    ),
    section(
      'Rig Options & Toggles',
      '[CFG]',
      false,
      check(
        'Expert mode ',
        '(unconstrained \xB190\xB0)',
        () => S.expert,
        (v) => {
          S.expert = v;
          S = clampStateToLimits(S);
        }
      ),
      check(
        'Full elasticity ',
        '(unconstrained metacarpals)',
        () => S.fullElasticity,
        (v) => {
          S.fullElasticity = v;
          S = clampStateToLimits(S);
          draw();
        }
      ),
      check(
        'Knuckle overlap ',
        '(0.5 / end-to-end)',
        () => S.o > 0,
        (v) => (S.o = v ? 0.5 : 0)
      ),
      check(
        'Scale widths ',
        '(by SUM\u2212KN / 7)',
        () => S.wscale,
        (v) => (S.wscale = v)
      ),
      check(
        'Handpiece art ',
        '(all five digits)',
        () => S.skin,
        (v) => (S.skin = v)
      ),
      check(
        'Show bend arrows ',
        '(lime = curl, red = hyperextension)',
        () => showBend,
        (v) => (showBend = v)
      ),
      check(
        'Show bone & palm boxes ',
        '(4:1, 2:1, 1:1, 1:1 + 12.5% margins)',
        () => S.boxes,
        (v) => (S.boxes = v)
      )
    )
  );

  const $stem = el('input', { type: 'text', value: 'gotz-puppyt' }) as HTMLInputElement;
  const stem = () => $stem.value.trim() || 'gotz-puppyt';

  const guard = (fn: () => Promise<void>) => async () => {
    if (busy || preview) return;
    busy = true;
    try {
      await fn();
    } catch (e: any) {
      toast(`Export failed: ${e.message || e}`, 4000);
    } finally {
      busy = false;
      progress();
    }
  };

  const $snaps = el('div', { id: 'snaps' });
  stage.append($snaps);

  function deliver(blob: Blob, name: string) {
    downloadBlob(blob, name);
    const url = URL.createObjectURL(blob);
    const isImg = blob.type.startsWith('image/');
    const card = el('div', { class: 'snap' });
    const close = () => {
      URL.revokeObjectURL(url);
      card.remove();
    };
    const copy2 = el(
      'button',
      {
        onclick: async () => {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            toast('Copied to clipboard', 1500);
          } catch {
            toast('Copy is blocked here: use Save, or long-press / right-click the picture', 3200);
          }
        },
      },
      'Copy'
    );
    card.append(
      isImg ? el('img', { src: url, alt: name }) : el('span', { class: 'ico' }, '[PKG]'),
      el(
        'div',
        { class: 'col' },
        el('b', {}, name),
        el(
          'small',
          {},
          isImg ? 'Nothing downloaded? Long-press / right-click the picture, or:' : 'Nothing downloaded? Use Save:'
        ),
        el(
          'div',
          { class: 'r2' },
          el('a', { href: url, download: name }, 'Save'),
          ...(blob.type === 'image/png' ? [copy2] : []),
          btn('[X]', close, { title: 'Dismiss' })
        )
      )
    );
    $snaps.append(card);
    while ($snaps.children.length > 3) {
      ($snaps.firstElementChild?.querySelector('button:last-child') as HTMLButtonElement)?.click();
    }
  }

  const $bar = el('div', { class: 'bar', hidden: '' }, el('i')) as HTMLElement;
  const $stage = el('small', {}) as HTMLElement;
  function progress(stageText?: string, cur?: number, tot?: number) {
    $bar.hidden = !stageText;
    if (stageText && cur !== undefined && tot !== undefined) {
      $stage.textContent = `${stageText} ${cur}/${tot}`;
      ($bar.firstChild as HTMLElement).style.width = Math.round((cur / tot) * 100) + '%';
    } else {
      $stage.textContent = '';
    }
  }

  async function stillMarkup() {
    const markup = frameMarkup(S);
    const m = makeMeasurer();
    try {
      return { markup, vb: squareViewBox(m.measure(markup)) };
    } finally {
      m.destroy();
    }
  }

  const pngJob = (name: string) =>
    guard(async () => {
      const { markup, vb } = await stillMarkup();
      deliver(await canvasBlob(await canvasFromMarkup(markup, vb, 1024)), name);
      toast(`Exported ${name}`, 2500);
    });

  const savePng = () => pngJob(stem() + '.png')();
  let snaps = 0;
  const snapPng = () => {
    if (preview) return toast('Stop the preview first, then press Space', 2200);
    if (busy) return;
    toast('Saving PNG\u2026', 1200);
    pngJob(`${stem()}-${String(++snaps).padStart(3, '0')}.png`)();
  };

  const saveSvg = guard(async () => {
    const { markup, vb } = await stillMarkup();
    deliver(new Blob([buildSvgDocument(markup, vb, 1024)], { type: 'image/svg+xml;charset=utf-8' }), stem() + '.svg');
    toast(`Exported ${stem()}.svg`, 2500);
  });

  fly(
    'img',
    'r',
    'Save Pose Image',
    section(
      'Image Export Formats',
      '[IMG]',
      true,
      el('label', {}, 'Filename stem'),
      $stem,
      el(
        'div',
        { class: 'r2' },
        btn('Save PNG', savePng, { title: 'Transparent 1024\xD71024 PNG (Space saves one instantly)' }),
        btn('Save SVG', saveSvg, { title: 'Vector SVG' })
      )
    ),
    section(
      'Format Info & Resolution',
      '{}',
      false,
      el('small', {}, 'Centered 1024\xD71024 transparent export in the violet / lime palette.')
    )
  );

  const $dur = el('input', {
    type: 'range',
    min: 0.2,
    max: 4,
    step: 0.1,
    value: 1,
    style: 'accent-color:var(--acc)',
  }) as HTMLInputElement;
  const $durL = el('label', {}, 'Duration (1s)');

  // Synced export FPS dropdown
  const $fps = el(
    'select',
    {},
    ...FPS_MODES.map((m) => el('option', { value: String(m.fps) }, `${m.name} (${m.fps} fps)`))
  ) as HTMLSelectElement;
  $fps.value = String(currentFps);
  $fps.onchange = () => {
    const found = FPS_MODES.find((m) => String(m.fps) === $fps.value);
    if (found) setFpsMode(found.id);
  };

  const $pv = btn('|&gt; Preview transition', async () => {
    if (preview) {
      if (preview.raf) cancelAnimationFrame(preview.raf);
      S = preview.orig;
      preview = null;
      frozen = false;
      $pv.textContent = '|&gt; Preview transition';
      return draw();
    }
    if (busy) return;
    const from = poseState(selFrom.value);
    const to = poseState(selTo.value);
    preview = { orig: copy(S) };
    frozen = true;
    try {
      svg.setAttribute('viewBox', (await buildSequence(from, to, 12)).viewBox);
    } catch (e: any) {
      preview = null;
      frozen = false;
      return toast(`Preview failed: ${e.message || e}`, 3000);
    }
    const ms = Math.max(300, Number($dur.value) * 1000);
    const t0 = performance.now();
    let lastPreviewTick = 0;
    $pv.textContent = '[] Stop preview';
    const loop = (now: number) => {
      // Preview strictly steps according to the active framerate!
      if (currentFps >= 60 || now - lastPreviewTick >= frameInterval) {
        lastPreviewTick = now;
        const e = (now - t0) % (ms * 2);
        const l = e < ms ? e / ms : 2 - e / ms;
        S = interpolatePose(from, to, 0.5 - 0.5 * Math.cos(l * Math.PI));
        draw();
      }
      if (preview) {
        preview.raf = requestAnimationFrame(loop);
      }
    };
    preview.raf = requestAnimationFrame(loop);
  }) as HTMLButtonElement;

  // Captured animations always match the active FPS toggle!
  async function exportAnim(kind: 'gif' | 'apng' | 'zip') {
    const from = poseState(selFrom.value);
    const to = poseState(selTo.value);
    const fps = currentFps; // Strict match with active toggle
    const dur = +$dur.value;
    const n = Math.max(2, Math.round(dur * fps));
    const size = 512;
    const parts: any[] = [];
    const seq = await buildSequence(from, to, n, (c, t) => progress('Measuring frames', c, t));
    for (let i = 0; i < n; i++) {
      progress(`Rendering ${kind.toUpperCase()} frame (${currentFpsMode.name} ${fps} FPS)`, i + 1, n);
      const cv = await canvasFromMarkup(seq.frames[i].markup, seq.viewBox, size);
      const px = () => cv.getContext('2d')!.getImageData(0, 0, size, size).data;
      parts.push(
        kind === 'gif'
          ? gifFrame(gifIndices(new Uint8Array(px())), size, size, fps)
          : kind === 'apng'
          ? await compressPngPixels(new Uint8Array(px()), size, size)
          : new Uint8Array(await (await canvasBlob(cv)).arrayBuffer())
      );
    }
    let blob: Blob;
    let name: string;
    if (kind === 'gif') {
      blob = new Blob([...gifHeader(size, size), ...parts, Uint8Array.of(59)], { type: 'image/gif' });
      name = `-${currentFpsMode.id}-anim.gif`;
    } else if (kind === 'apng') {
      blob = encodeApng(parts, size, size, fps);
      name = `-${currentFpsMode.id}-anim.png`;
    } else {
      const files = parts.map((data, i) => ({ name: `frame_${String(i).padStart(3, '0')}.png`, data }));
      files.push({
        name: 'animation.json',
        data: enc(
          JSON.stringify(
            {
              app: 'Gotz.Puppyt Hand Rig v2',
              fpsMode: currentFpsMode.name,
              fps: currentFps,
              from: selFrom.value,
              to: selTo.value,
              durationSeconds: dur,
              frameCount: n,
              viewBox: seq.viewBox,
              frameNames: files.map((f) => f.name),
            },
            null,
            2
          )
        ),
      });
      blob = zipStore(files);
      name = `-${currentFpsMode.id}-frames.zip`;
    }
    deliver(blob, stem() + name);
    toast(`Exported ${stem()}${name} (${currentFps} FPS)`, 2500);
  }

  const expBtn = (label: string, kind: 'gif' | 'apng' | 'zip', title: string) =>
    btn(label, guard(() => exportAnim(kind)), { title });

  let frameIdx: number | null = null;
  let filmRev = 0;
  let filmSig = '';
  const $film = el('div', { class: 'film' });
  const $clear = btn(
    'Clear selection',
    () => {
      frameIdx = null;
      markFrame();
    },
    { hidden: '' }
  );
  const secFilm = section(
    'Keyframe Filmstrip Preview',
    '[*]',
    true,
    el('small', {}, 'Click a thumbnail to preview that frame on stage:'),
    $film,
    $clear
  );
  const markFrame = () => {
    $film.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === frameIdx));
    $clear.hidden = frameIdx === null;
  };

  async function filmstrip() {
    const rev = ++filmRev;
    const seq = await buildSequence(poseState(selFrom.value), poseState(selTo.value), 6);
    if (rev !== filmRev) return;
    $film.replaceChildren(
      ...seq.frames.map((f, i) => {
        const pct = Math.round((i / 5) * 100);
        const sec = ((i / 5) * Number($dur.value)).toFixed(2) + 's';
        const b = el('button', {
          title: `Frame ${pct}% (${sec}): click to preview on stage`,
          onclick: () => {
            if (preview) return;
            cancelAnimationFrame(anim);
            commit();
            frameIdx = i;
            S = copy(f.pose);
            draw();
            commit();
            markFrame();
            toast(`Previewing frame ${pct}% (${sec})`, 1500);
          },
        });
        b.innerHTML = `<svg viewBox="${seq.viewBox}">${f.markup}</svg><span>${pct}%</span><small>${sec}</small>`;
        return b;
      })
    );
    badge(secFilm, '6 frames');
    markFrame();
  }

  sync.push(() => {
    if (flies.anim.hidden) return;
    const sig = [selFrom.value, selTo.value, $dur.value, currentFps, JSON.stringify(keep(S)), savedRev].join('|');
    if (sig !== filmSig) {
      filmSig = sig;
      filmstrip().catch(() => {});
    }
  });

  selFrom.onchange = selTo.onchange = () => {
    frameIdx = null;
    sync.forEach((f) => f());
  };

  $dur.oninput = () => {
    $durL.textContent = `Duration (${$dur.value}s)`;
    sync.forEach((f) => f());
  };

  fly(
    'anim',
    'r',
    'Pose-to-Pose Animation',
    section('Transition Pose Selectors', '[FLM]', true, el('label', {}, 'From pose'), selFrom, el('label', {}, 'To pose'), selTo),
    secFilm,
    section('Timing & Live Preview', '[>]', true, $durL, $dur, el('label', {}, 'Framerate (Matches Active Toggle)'), $fps, $pv),
    section(
      'Export Animation Encoders',
      '[V]',
      true,
      el(
        'div',
        { class: 'r2' },
        expBtn('GIF', 'gif', 'Transparent animated GIF (matches active FPS)'),
        expBtn('APNG', 'apng', 'Full-colour animated PNG (matches active FPS)'),
        expBtn('ZIP', 'zip', 'Numbered PNG frames + animation.json')
      ),
      $bar,
      $stage,
      el('small', {}, 'Captured animations always render at the selected framerate (Brad 8, Lotte 12, Anime 15, Walt 24, Pure 60).')
    )
  );

  // Hand Build Button (5F standard / 2F claw / 3F trident / 4F mickey)
  const bldBtn = el('button', { class: 'bld', onclick: cycleBuild }) as HTMLButtonElement;

  // Framerate Toggle Button located directly beneath the hand build button!
  const fpsBtn = el('button', { class: 'bld', onclick: cycleFpsMode }) as HTMLButtonElement;

  sync.push(() => {
    const b = BUILDS.find((x) => x[0] === S.build) ?? BUILDS[0];
    bldBtn.title = `Build: ${b[2]}. Click for next.`;
    bldBtn.replaceChildren(el('b', {}, b[1]), b[0] === 'mickey' ? 'Mickey' : b[0]);

    fpsBtn.title = `Framerate: ${currentFpsMode.name} (${currentFps} FPS). Click to cycle: Brad (8) → Lotte (12) → Anime (15) → Walt (24) → Pure (60).`;
    fpsBtn.replaceChildren(el('b', {}, String(currentFps)), currentFpsMode.name);

    container.querySelectorAll('[data-fps]').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.fps === currentFpsMode.id)
    );
  });

  stage.append(
    el(
      'div',
      { class: 'tb l' },
      tbtn('[LIB]', 'Pose library', () => show('lib')),
      tbtn('[~]', 'Live pose morph', () => show('morph')),
      el('hr'),
      $quickList,
      el('hr'),
      tbtn('+15', 'Curl all fingers +15\xB0', () => curl(15)),
      tbtn('-15', 'Extend all fingers \u221215\xB0', () => curl(-15)),
      tbtn('[: :]', 'Randomize gesture', shuffle)
    ),
    el(
      'div',
      { class: 'tb r' },
      bldBtn,
      fpsBtn, // Located directly beneath the hand toggle!
      el('hr'),
      tbtn('[CFG]', 'Hand rig settings', () => show('rig')),
      tbtn('[IMG]', 'Save pose image', () => show('img')),
      tbtn('[FLM]', 'Pose-to-pose animation', () => show('anim')),
      el('hr'),
      tbtn('<<', 'Undo (Ctrl+Z)', () => stepHist(-1), { class: 'u' }),
      tbtn('>>', 'Redo (Ctrl+Y)', () => stepHist(1), { class: 'r' }),
      tbtn('<|>', 'Mirror hand', mirror),
      tbtn('[0]', 'Reset to neutral flat', reset),
      el('hr'),
      tbtn('[+P]', 'Quick save as new numbered pose', () => savePose(true)),
      tbtn('[-P]', 'Delete selected saved pose', delPose)
    )
  );

  const buildsEl = $<HTMLElement>('#builds');
  if (buildsEl) {
    buildsEl.append(
      ...BUILDS.map(([id, , label]) =>
        btn(id === 'mickey' ? "Mickey's" : id, () => setBuild(id), {
          'data-b': id,
          title: label,
          style: 'text-transform:capitalize',
        })
      )
    );
  }

  // Header segmented framerate mode buttons
  const fpsModesEl = $<HTMLElement>('#fps-modes');
  if (fpsModesEl) {
    fpsModesEl.append(
      ...FPS_MODES.map((mode) =>
        btn(mode.name, () => setFpsMode(mode.id), {
          'data-fps': mode.id,
          title: mode.title,
        })
      )
    );
  }

  sync.push(
    () => container.querySelectorAll('[data-b]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.b === S.build)),
    () => {
      const infoEl = $<HTMLElement>('#info');
      if (infoEl) {
        infoEl.textContent = `Wrist ${S.wrist}\xB0 \xB7 Splay ${S.splay}% \xB7 Tilt ${S.tilt}\xB0 \xB7 Pose: ${getPoseLanguage(S)} \xB7 ${currentFpsMode.name} (${currentFps} FPS)`;
      }
    }
  );

  const hu = $<HTMLButtonElement>('#hu');
  if (hu) hu.onclick = () => stepHist(-1);
  const hr = $<HTMLButtonElement>('#hr');
  if (hr) hr.onclick = () => stepHist(1);
  const hq = $<HTMLButtonElement>('#hq');
  if (hq) hq.onclick = () => ($<HTMLDivElement>('#help')!.hidden = false);
  const hx = $<HTMLButtonElement>('#hx');
  if (hx) hx.onclick = () => ($<HTMLDivElement>('#help')!.hidden = true);

  const setTheme = (t: 'dark' | 'light') => {
    document.body.dataset.theme = t;
    const th = $<HTMLButtonElement>('#th');
    if (th) th.textContent = t === 'dark' ? '[SUN]' : '[MOON]';
  };
  const th = $<HTMLButtonElement>('#th');
  if (th) th.onclick = () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  setTheme('dark');

  const controlsContainer = $<HTMLDivElement>('#c');
  if (controlsContainer) {
    controlsContainer.replaceChildren();

    const menuHeader = el('div', { class: 'bottom-menu-header' });

    const tabBar = el('div', { class: 'finger-tab-bar' });
    FINGER_TABS.forEach((tab) => {
      const b = el(
        'button',
        {
          class: `ftab ${tab.id === 'all' ? 'all-tab' : ''} ${tab.id === activeTab ? 'on' : ''}`,
          onclick: () => {
            activeTab = tab.id;
            updateFingerTabs();
          },
        },
        tab.label
      ) as HTMLButtonElement;
      tabButtons[tab.id] = b;
      tabBar.append(b);
    });

    $menuLabel = el('span', { class: 'menu-finger-label' }, 'INDEX');
    $menuReach = el('span', { class: 'menu-finger-reach' }, 'Reach: 7.5 pyxls');
    const labelReachBox = el('div', { class: 'menu-label-reach' }, $menuLabel, $menuReach);

    tglBoxMeta = createRotationToggleBox('meta', 'Meta');
    tglBoxFinger = createRotationToggleBox('finger', 'Finger');
    tglBoxGrip = createRotationToggleBox('grip', 'Grip');
    tglBoxTip = createRotationToggleBox('tip', 'Tip');

    const togglesBox = el(
      'div',
      { class: 'toggles-group' },
      el('span', { class: 'toggles-title' }, 'ROTATION TOGGLES:'),
      tglBoxMeta.container,
      tglBoxFinger.container,
      tglBoxGrip.container,
      tglBoxTip.container
    );

    const subBar = el('div', { class: 'menu-sub-bar' }, labelReachBox, togglesBox);
    menuHeader.append(tabBar, subBar);

    const cardsGrid = el('div', { class: 'finger-cards-grid' });
    const CARD_ORDER: Finger[] = ['index', 'middle', 'ring', 'pinky', 'thumb'];

    for (const d of CARD_ORDER) {
      const mid = d === 'middle';
      const thFinger = d === 'thumb';
      const g = el('div', { class: 'grp' });
      fingerGroupEls[d] = g;

      const set3 = (i: number, v: number) => (S.cj[d][i] = v);
      g.append(el('h3', {}, mid ? 'Middle (Bird) Controls' : d[0].toUpperCase() + d.slice(1) + ' Controls'));
      if (!mid) {
        g.append(
          slider(
            'Splay add',
            '%',
            () => [-100, 100],
            () => (thFinger ? S.thumb : S.fs[d]),
            (v) => (thFinger ? (S.thumb = v) : (S.fs[d] = v))
          )
        );
      }
      g.append(
        slider(
          'Rotation',
          '\xB0',
          () => rRange(d, S.expert, S.fullElasticity),
          () => S.rot[d],
          (v) => (S.rot[d] = v)
        ),
        slider(
          'Curl (all)',
          '\xB0',
          () => cRange(d, S.expert),
          () => Math.round(S.cj[d].reduce((a, b) => a + b) / 3),
          (v) => (S.cj[d] = [v, v, v])
        ),
        el(
          'details',
          { open: '' },
          el('summary', {}, 'Joint curls (3 joints)'),
          el(
            'div',
            { class: 'col' },
            ...['Knuckle', 'Middle joint', 'Tip joint'].map((l, i) =>
              slider(
                l,
                '\xB0',
                () => cRange(d, S.expert),
                () => S.cj[d][i],
                (v) => set3(i, v)
              )
            )
          )
        )
      );
      sync.push(() => {
        g.classList.toggle('off', !getActiveFingers(S.build).includes(d));
      });
      cardsGrid.append(g);
    }

    sync.push(updateTopHeaderAndToggles);

    controlsContainer.append(
      menuHeader,
      cardsGrid,
      el('div', {
        id: 'rd',
        html: '<b>Gotz.Puppyt Hand Rig v2 \u2014 canonical rules &amp; reach.</b><br><b>Reach:</b> Middle 8 raw / 7 functional \xB7 Ring 7.5 / 6.5 \xB7 Index 7.5 / 6.5 \xB7 Pinky 7 / 6 \xB7 Thumb 5 / 4.5.<br><b>Proportions:</b> the middle finger sets the master 4:2:1:1 (metacarpal : proximal : middle : distal); each bone fits a 1-wide box, the distal leaves 12.5% empty each side (0.75 pyxl). 1 pyxl = 100 px.<br><b>Framerate Modes:</b> Brad 8 FPS \xB7 Lotte 12 FPS (Default) \xB7 Anime 15 FPS \xB7 Walt 24 FPS \xB7 Pure 60 FPS.',
      })
    );

    updateFingerTabs();
  }

  // ----------------------------------------------------
  // Bottom Pose Timeline with Easing Curve Dragging
  // ----------------------------------------------------
  let tlTime = 0; // 0 to 1
  let tlAmplitude = 0; // 0 = straight line. Positive = ease out / in-out, Negative = ease in
  let tlFromPose = NEUTRAL;
  let tlToPose = 'Fist';
  let tlPlaying = false;
  let tlLoop = true;
  let tlDuration = 1.5;
  let tlPlayRaf: number | null = null;
  let tlLastPlayTick = 0;

  function calcTimelineEasing(t: number, amplitude: number): number {
    if (Math.abs(amplitude) < 0.5) return t; // exact linear straight line
    const h = clamp(amplitude / 24, -1, 1);
    if (h > 0) {
      // Dragged UP: Ease-Out / Ease-In-Out
      const sCurve = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const easeOut = Math.sin((t * Math.PI) / 2);
      const curve = 0.6 * sCurve + 0.4 * easeOut;
      return (1 - h) * t + h * curve;
    } else {
      // Dragged DOWN: Ease-In / Accelerate
      const k = -h;
      const easeIn = 1 - Math.cos((t * Math.PI) / 2);
      return (1 - k) * t + k * easeIn;
    }
  }

  function getEasingName(amplitude: number): string {
    if (Math.abs(amplitude) < 0.8) return 'Linear (Straight)';
    if (amplitude > 14) return `Strong Ease-Out (+${Math.round((amplitude / 24) * 100)}%)`;
    if (amplitude > 2) return `Ease In-Out (+${Math.round((amplitude / 24) * 100)}%)`;
    if (amplitude < -14) return `Strong Ease-In (${Math.round((amplitude / 24) * 100)}%)`;
    return `Ease In (${Math.round((amplitude / 24) * 100)}%)`;
  }

  function applyTimelinePose(t: number) {
    const from = poseState(tlFromPose);
    const to = poseState(tlToPose);
    const easedT = calcTimelineEasing(t, tlAmplitude);
    S = interpolatePose(from, to, easedT);
    draw();
  }

  function renderTimeline() {
    const track = $<HTMLDivElement>('#tl-track');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const width = Math.max(100, rect.width || 300);
    const x0 = 14;
    const x1 = width - 14;
    const y0 = 24;

    const guide = $<SVGLineElement>('#tl-guide');
    const line = $<SVGPathElement>('#tl-line');
    const nodeStart = $<SVGCircleElement>('#tl-node-start');
    const nodeEnd = $<SVGCircleElement>('#tl-node-end');
    const headGroup = $<SVGGElement>('#tl-head-group');
    const easeBadge = $<HTMLElement>('#tl-ease-badge');
    const timeEl = $<HTMLElement>('#tl-time');

    if (guide) {
      guide.setAttribute('x1', String(x0));
      guide.setAttribute('x2', String(x1));
      guide.setAttribute('y1', String(y0));
      guide.setAttribute('y2', String(y0));
    }
    if (nodeStart) {
      nodeStart.setAttribute('cx', String(x0));
      nodeStart.setAttribute('cy', String(y0));
    }
    if (nodeEnd) {
      nodeEnd.setAttribute('cx', String(x1));
      nodeEnd.setAttribute('cy', String(y0));
    }

    // Straight line when amplitude is 0, curved when dragged up or down
    const isStraight = Math.abs(tlAmplitude) < 0.5;
    const cpX = (x0 + x1) / 2;
    const cpY = y0 - tlAmplitude;
    let d = '';
    if (isStraight) {
      d = `M ${x0} ${y0} L ${x1} ${y0}`;
    } else {
      d = `M ${x0} ${y0} Q ${cpX} ${cpY} ${x1} ${y0}`;
    }
    if (line) {
      line.setAttribute('d', d);
      line.classList.toggle('bending', !isStraight);
    }

    // Position playhead on the line
    const curX = x0 + (x1 - x0) * tlTime;
    const curY = isStraight
      ? y0
      : (1 - tlTime) * (1 - tlTime) * y0 + 2 * (1 - tlTime) * tlTime * cpY + tlTime * tlTime * y0;
    if (headGroup) {
      headGroup.setAttribute('transform', `translate(${curX - 14}, ${curY - y0})`);
    }

    if (easeBadge) {
      easeBadge.textContent = getEasingName(tlAmplitude);
    }

    if (timeEl) {
      timeEl.textContent = `${Math.round(tlTime * 100)}% · ${(tlTime * tlDuration).toFixed(2)}s`;
    }
  }

  function startTimeline() {
    tlPlaying = true;
    const playBtn = $<HTMLButtonElement>('#tl-play');
    if (playBtn) playBtn.textContent = '||';
    if (tlTime >= 1) tlTime = 0;
    let lastTime = performance.now();
    tlLastPlayTick = performance.now();

    const loop = (now: number) => {
      if (!tlPlaying) return;
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      // Frame stepping matching the active FPS mode toggle
      if (currentFps >= 60 || now - tlLastPlayTick >= frameInterval) {
        tlLastPlayTick = now;
        tlTime += delta / tlDuration;
        if (tlTime >= 1) {
          if (tlLoop) {
            tlTime = tlTime % 1;
          } else {
            tlTime = 1;
            stopTimeline();
            renderTimeline();
            applyTimelinePose(1);
            return;
          }
        }
        renderTimeline();
        applyTimelinePose(tlTime);
      }
      tlPlayRaf = requestAnimationFrame(loop);
    };
    tlPlayRaf = requestAnimationFrame(loop);
  }

  function stopTimeline() {
    tlPlaying = false;
    if (tlPlayRaf) {
      cancelAnimationFrame(tlPlayRaf);
      tlPlayRaf = null;
    }
    const playBtn = $<HTMLButtonElement>('#tl-play');
    if (playBtn) playBtn.textContent = '|>';
  }

  const tlPlayBtn = $<HTMLButtonElement>('#tl-play');
  if (tlPlayBtn) {
    tlPlayBtn.onclick = () => {
      if (tlPlaying) stopTimeline();
      else startTimeline();
    };
  }

  const tlLoopBtn = $<HTMLButtonElement>('#tl-loop');
  if (tlLoopBtn) {
    tlLoopBtn.onclick = () => {
      tlLoop = !tlLoop;
      tlLoopBtn.classList.toggle('on', tlLoop);
      toast(tlLoop ? 'Loop on' : 'Loop off', 1200);
    };
  }

  if (tlFromSelect) {
    tlFromSelect.onchange = () => {
      tlFromPose = tlFromSelect.value;
      applyTimelinePose(tlTime);
    };
  }

  if (tlToSelect) {
    tlToSelect.onchange = () => {
      tlToPose = tlToSelect.value;
      applyTimelinePose(tlTime);
    };
  }

  const tlSwapBtn = $<HTMLButtonElement>('#tl-swap');
  if (tlSwapBtn) {
    tlSwapBtn.onclick = () => {
      const tmp = tlFromPose;
      tlFromPose = tlToPose;
      tlToPose = tmp;
      if (tlFromSelect) tlFromSelect.value = tlFromPose;
      if (tlToSelect) tlToSelect.value = tlToPose;
      applyTimelinePose(tlTime);
      toast('Swapped Start & End poses', 1200);
    };
  }

  const tlSetStartBtn = $<HTMLButtonElement>('#tl-set-start');
  if (tlSetStartBtn) {
    tlSetStartBtn.onclick = () => {
      const n = 'Start Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      tlFromPose = n;
      if (tlFromSelect) tlFromSelect.value = n;
      applyTimelinePose(tlTime);
      toast('Pinned current canvas pose as Start', 1500);
    };
  }

  const tlSetEndBtn = $<HTMLButtonElement>('#tl-set-end');
  if (tlSetEndBtn) {
    tlSetEndBtn.onclick = () => {
      const n = 'End Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      tlToPose = n;
      if (tlToSelect) tlToSelect.value = n;
      applyTimelinePose(tlTime);
      toast('Pinned current canvas pose as End', 1500);
    };
  }

  const easeBadge = $<HTMLElement>('#tl-ease-badge');
  if (easeBadge) {
    easeBadge.onclick = () => {
      tlAmplitude = 0;
      renderTimeline();
      applyTimelinePose(tlTime);
      toast('Reset easing to straight line (Linear)', 1500);
    };
  }

  // Interactive timeline track dragging
  let tlDragging = false;
  let tlDragStartY = 0;
  let tlDragStartAmp = 0;
  let tlLastScrubTime = 0;
  const trackEl = $<HTMLDivElement>('#tl-track');
  const tipEl = $<HTMLDivElement>('#tl-tip');

  if (trackEl) {
    trackEl.onpointerdown = (e: PointerEvent) => {
      tlDragging = true;
      trackEl.setPointerCapture(e.pointerId);
      tlDragStartY = e.clientY;
      tlDragStartAmp = tlAmplitude;
      if (tlPlaying) stopTimeline();

      const rect = trackEl.getBoundingClientRect();
      const x0 = 14;
      const x1 = rect.width - 14;
      const t = clamp((e.clientX - rect.left - x0) / (x1 - x0), 0, 1);
      tlTime = t;
      tlLastScrubTime = performance.now();

      renderTimeline();
      applyTimelinePose(t);

      if (tipEl) {
        tipEl.hidden = false;
        tipEl.style.left = `${Math.min(rect.width - 60, Math.max(60, e.clientX - rect.left))}px`;
        tipEl.textContent = `${Math.round(t * 100)}% · ${getEasingName(tlAmplitude)}`;
      }
    };

    trackEl.onpointermove = (e: PointerEvent) => {
      if (!tlDragging) return;
      const now = performance.now();
      const rect = trackEl.getBoundingClientRect();
      const x0 = 14;
      const x1 = rect.width - 14;
      const t = clamp((e.clientX - rect.left - x0) / (x1 - x0), 0, 1);
      tlTime = t;

      // Vertical movement adjusts curve easing (drag UP = arch, drag DOWN = dip)
      const deltaY = tlDragStartY - e.clientY;
      tlAmplitude = clamp(tlDragStartAmp + deltaY * 0.4, -24, 24);

      renderTimeline();

      // Throttled pose update during scrubbing matching the active framerate
      if (currentFps >= 60 || now - tlLastScrubTime >= frameInterval) {
        tlLastScrubTime = now;
        applyTimelinePose(t);
      }

      if (tipEl) {
        tipEl.style.left = `${Math.min(rect.width - 60, Math.max(60, e.clientX - rect.left))}px`;
        tipEl.textContent = `${Math.round(t * 100)}% · ${getEasingName(tlAmplitude)}`;
      }
    };

    trackEl.onpointerup = trackEl.onpointercancel = () => {
      if (!tlDragging) return;
      tlDragging = false;
      if (tipEl) tipEl.hidden = true;
      applyTimelinePose(tlTime);
      commit();
    };

    trackEl.ondblclick = () => {
      tlAmplitude = 0;
      renderTimeline();
      applyTimelinePose(tlTime);
      toast('Reset to straight line (Linear)', 1500);
    };
  }

  // Node clicks for quick snap to start or end
  const nodeStart = $<SVGCircleElement>('#tl-node-start');
  if (nodeStart) {
    nodeStart.onclick = (e) => {
      e.stopPropagation();
      tlTime = 0;
      renderTimeline();
      applyTimelinePose(0);
    };
  }
  const nodeEnd = $<SVGCircleElement>('#tl-node-end');
  if (nodeEnd) {
    nodeEnd.onclick = (e) => {
      e.stopPropagation();
      tlTime = 1;
      renderTimeline();
      applyTimelinePose(1);
    };
  }

  refresh();
  updHist();
  draw();
  renderTimeline();

  // Return a cleanup function
  return () => {
    cancelAnimationFrame(anim);
    if (preview?.raf) cancelAnimationFrame(preview.raf);
    if (tlPlayRaf) cancelAnimationFrame(tlPlayRaf);
    if (dragTimer) clearTimeout(dragTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
