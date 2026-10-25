# Gotz.Puppyt Hand Rig v2 — Ghost Styling, Multi-Pose Onion Depth & UI Decluttering

Comprehensive plan to upgrade the onion skin ghosting aesthetics, add toggleable N-pose historical onion skin depth, declutter side panel tools, and introduce a right-side bottom posing wheel.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed by the user in Phase 1:
> - **Side Panel Architecture**: Reorganize redundant buttons into clean icon-button sidebars with flyout drawers for deep tools (`[LIB]`, `[CFG]`, `[IMG]`, `[FLM]`).
> - **Onion Skin Depth Control**: Position a direct click/toggle depth badge (e.g. `[N: 2]`) right next to the `[ONION]` button on the bottom timeline.
> - **Posing Wheel Addition**: Add a dedicated compact Posing Wheel to the bottom of the right control menu for rapid gesture manipulation.

---

## 1. Overview & Core Concept

1. **Blurred & Medium Gray Ghost Overlays**:
   - Replace basic dashed stroke overlays with a blurred SVG filter effect (`feGaussianBlur`) and medium gray fill (`#6e687e` / `rgba(110, 104, 126, 0.55)`).
   - Onion skin ghosts will render the hand silhouette in medium gray (replacing black fill) with soft gaussian blur.

2. **Toggleable Onion Skin History Depth (1 to 4 Poses)**:
   - When Onion Skin is ON, maintain a history ring buffer of the last N poses edited on canvas or keyframed.
   - Default history depth is **2 poses**. Clicking the `[N: 2]` timeline badge cycles depth between **1**, **2**, **3**, and **4** poses with decreasing opacity tiers (100% -> 70% -> 45% -> 25%).

3. **Side Panel Decluttering & Elimination of Duplicates**:
   - Strip redundant buttons (e.g., duplicate undo/redo, redundant quick pose buttons) from side panels.
   - **Left Dock**: Focus on Pose Library `[LIB]`, Quick Gesture Preset chips, and Live Morph `[~]`.
   - **Right Dock**: Focus on Rig Settings `[CFG]`, Save Image `[IMG]`, Animation Exporter `[FLM]`, and a new **Posing Wheel** at the bottom.

4. **Compact Posing Wheel**:
   - Integrated directly into the bottom of the right controls panel.
   - Features a 360° circular dial to adjust wrist angle, finger curl tilt, and quick orientation snapping.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Scrubbing & Onion Ghosting**:
   - Toggle `[ONION]` on the bottom timeline.
   - Click `[N: 2]` to cycle onion skin depth: `[N: 1]`, `[N: 2]`, `[N: 3]`, `[N: 4]`.
   - The canvas displays ghosted medium-gray blurred silhouettes of the last N historical poses with progressive fading and soft edge blur.

2. **Posing Wheel Interaction**:
   - Scroll or open the right controls menu to reveal the bottom **Posing Wheel**.
   - Drag or rotate the circular dial to rotate the wrist or apply macro finger curling smoothly in real time.

3. **Decluttered Navigation**:
   - Clean, non-repetitive side toolbars with single-intent icon buttons.
   - All timeline and keyframe controls remain anchored to the persistent bottom bar.

---

## 3. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Gotz.Puppyt Stage Canvas                         │
│                                                                        │
│  ┌───────────────────────┐                  ┌──────────────────────┐   │
│  │ Left Side Dock        │                  │ Right Side Dock      │   │
│  │                       │   <svg> Stage    │                      │   │
│  │ [LIB] Library         │   - Hand Art     │ [CFG] Rig Options    │   │
│  │ [~]   Live Morph      │   - Ghost Filter │ [IMG] Save Image     │   │
│  │                       │     (#ghostBlur) │ [FLM] Animation      │   │
│  │ [Quick Gesture Chips] │   - Base Line    │                      │   │
│  └───────────────────────┘                  └──────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
│ Persistent Bottom Menu Header & Cards (With Posing Wheel in Right Col)  │
├────────────────────────────────────────────────────────────────────────┤
│ Bottom Timeline Bar                                                    │
│ [|>][LP] FROM:[ ] MID:[ ] TO:[ ] --(Track)-- [ONION][N: 2][PIN S/M/E]  │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Technical Changes

1. **SVG Blur & Fill Filter for Ghosts (`src/rig/engine.ts` & `src/index.css`)**:
   - Add `<filter id="ghostBlur"><feGaussianBlur stdDeviation="0.8"/></filter>` to the stage SVG `<defs>`.
   - Update `.onion-ghost` CSS rules to apply `fill: #6e687e; fill-opacity: 0.55; filter: url(#ghostBlur);`.

2. **Onion Skin Pose History Buffer**:
   - Maintain `let onionHistory: HandState[] = [];` capped at max depth `onionDepth` (default 2, toggleable 1..4).
   - Whenever `commit()` or `apply()` occurs, push the clean pose into `onionHistory`.
   - Render `onionHistory` items inside `<g id="onion-history">` with decreasing opacity.

3. **Posing Wheel Component**:
   - Render an interactive SVG/HTML wheel in the right control column.
   - Pointer events allow rotating the wheel ring to control `S.wrist` (-180° to +180°) and radial dragging for macro curl.

---

## 4. Implementation Steps

1. **Step 1: CSS & SVG Filter Setup for Blurred Gray Ghosts**:
   - Update `src/index.css` `.onion-ghost` styles to use medium gray fills and gaussian blur filters.
2. **Step 2: Onion Depth Ring Buffer & Timeline Toggle (`[N: 2]`)**:
   - Add `onionDepth` state (1 to 4) and timeline badge `[N: 2]` next to `[ONION]`.
   - Update `draw()` to render all N historical poses from `onionHistory`.
3. **Step 3: Posing Wheel Implementation**:
   - Build a circular 360° Posing Wheel at the bottom of the right control menu in `src/rig/engine.ts`.
4. **Step 4: Side Panel Decluttering**:
   - Remove redundant duplicate buttons across the left/right docks and header.
5. **Step 5: Compilation & Verification**:
   - Run `compile_applet` and `lint_applet` to verify zero errors.
