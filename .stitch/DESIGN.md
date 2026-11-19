# Design System: Cortex Spatial Intelligence Cockpit

## 1. Visual Theme & Atmosphere
A cockpit-dense, precision-machined aerospace instrument deck suspended above a live multi-pass WebGL2 gravitational cosmos.
- **Taste Coordinates:** Density `9/10` (Cockpit Dense), Variance `7/10` (Offset Asymmetric), Motion `7/10` (Hardware-Composited Fluid Precision).
- **Mood & Materiality:** Smoked obsidian glass (`Zinc-950` at `85%` opacity) with `1px` directional top-edge specular catchlights (`rgba(255, 255, 255, 0.09)`) and recessed carbon-matte wells. All luminous color drama belongs exclusively to the underlying 3D WebGL shader cosmos; the 2D HUD and hologram reader stay whisper-quiet, clinical, and razor-sharp so data legibility is instantaneous at a glance.

## 2. Color Palette & Roles
- **Smoked Obsidian Glass** (`rgba(9, 9, 11, 0.85)`) — Primary floating panel, instrument ribbon, drawer, and hologram reader surface (`backdrop-filter: blur(20px)`), never pure `#000000`.
- **Recessed Instrument Well** (`#0C0C0F` / `rgba(12, 12, 15, 0.92)`) — Segmented control tracks, `L1–L5` scrubber troughs, code terminals, and tabular telemetry wells.
- **Elevated Notch Surface** (`#18181B` / `Zinc-900`) — Active segmented thumb, keycap fill, and hovered tabular row surface.
- **Crisp Chalk Ink** (`#F4F4F5` / `Zinc-100`) — Primary headlines, active tab titles, and primary metric readouts.
- **Anodized Zinc** (`#A1A1AA` / `Zinc-400`) — Body prose across `L1–L5` literacy cards (`65ch` max measure) and secondary descriptions.
- **Muted Graphite** (`#71717A` / `Zinc-500`) — Micro-column headers, inactive scrubber indices, unit suffixes, and timestamps.
- **Titanium Hairline** (`rgba(255, 255, 255, 0.08)`) — `1px` structural borders, grid cell rules, and top-border section dividers.
- **Specular Top Highlight** (`rgba(255, 255, 255, 0.09)`) — `1px` inset directional top-edge highlight (`inset 0 1px 0 0 rgba(255,255,255,0.09)`) simulating machined optical glass.
- **Telemetry Teal** (`#2DD4BF`) — Singular calibrated primary accent (saturation `< 80%`) reserved strictly for active instrument states, the `L1–L5` scrubber indicator, focus-visible rings, and primary confirmation triggers. Semantic status dots (`#34D399` online, `#FBBF24` preview/caution, `#F43F5E` high-risk) appear strictly as `6px` status LEDs or `1px` subtle badges—never as neon button outer-glows.

## 3. Typography Rules
- **Display & Prose Sans:** `Geist` (fallback `-apple-system, BlinkMacSystemFont, sans-serif`) — Tight display tracking (`-0.02em`) on titles and section headers (`font-weight: 600`); relaxed `1.55` line-height and `65ch` maximum line width on `L1–L5` reader copy.
- **Instrument & Telemetry Mono:** `Geist Mono` / `JetBrains Mono` — Mandatory across all live counters, FPS/worker/latency readouts, `L1–L5` scrubber indices, pricing/context specs, keycap badges, and timestamps with `font-variant-numeric: tabular-nums` enforced globally so digits never jitter horizontally during real-time updates.
- **Scale & Rhythm:** Strict `4px` / `8px` spatial and typographic grid (`10px` micro-labels uppercase `+0.06em`, `11px` mono controls, `12.5px`–`13px` cockpit reader body, `14px`–`15px` tight-tracked hologram headlines).
- **Banned Typography:** Generic `Inter` display defaults, all serif typefaces in cockpit UI, and gradient-filled headline text.

## 4. Component Stylings
- **Buttons & Instrument Triggers:** Rectangular machined radius (`6px` / `0.375rem` for inline controls, `8px` / `0.5rem` for primary actions—replacing generic `rounded-full` pill clutter). Flat surface with `1px` `rgba(255,255,255,0.08)` border, `inset 0 1px 0 rgba(255,255,255,0.07)` top catchlight, and tactile `translateY(1px)` push feedback on `:active`. Zero neon outer-glow box-shadows.
- **Segmented Tracks (`L1–L5` Scrubber, Brain Selector, Industry Gravity):** Recessed `#0C0C0F` track (`padding: 2px`, `border-radius: 8px`, `border: 1px solid rgba(255,255,255,0.07)`) housing a smooth GPU-translated active indicator (`transform: translate3d(...)`, `background: #1F1F23`, `box-shadow: inset 0 1px 0 rgba(255,255,255,0.12)`).
- **Hologram Reader Cards (`DiegeticPool`):** Smoked Obsidian Glass (`rgba(9, 9, 11, 0.88)`, `border-radius: 12px`, `1px` `rgba(255,255,255,0.09)` border + `1px` top specular highlight + deep neutral elevation shadow `0 24px 48px -12px rgba(0,0,0,0.78)`). Internal sections separate cleanly via `1px` top hairlines (`rgba(255,255,255,0.06)`) rather than nested boxes-inside-boxes.
- **Switches & Tabs (`shadcn/ui` Radix Semantics):** Accessible `role="switch"` (`aria-checked`) toggles (`32px × 18px` track) and `role="tablist"` / `role="tab"` (`aria-selected`) drawers with crisp `1px` focus-visible rings in `#2DD4BF`.
- **Keycap Badges (`Kbd`):** Precision `18px`-tall monospace keycaps (`?`, `ESC`, `1–5`, `SHIFT`) in `#18181B` with `1px` `rgba(255,255,255,0.12)` border and bottom bevel `inset 0 -1px 0 rgba(0,0,0,0.6)`.
- **Glossary Pills (`L3` Builder Bridge):** Dotted bottom underline (`1px dotted #2DD4BF`) on `#18181B` inline chips; hover or tap reveals a crisp `1px`-bordered floating/inline definition callout with zero layout jump.

## 5. Layout Principles
- **Peripheral Aerospace Framing:** Top instrument bar consolidates identity, `L1–L5` global literacy track, client gravity, synthesis brain, and drawer/seed controls into a single compact `36px`-high horizontal instrument deck with `4px`/`8px` gaps—zero multi-row wrapping or pill sprawl on desktop viewports (`>= 1280px`), collapsing cleanly on narrow viewports.
- **Zero Occlusion of Central Cosmos:** Peripheral overlays hug the viewport edges (`8px`–`12px` inset margin) using `min-h-[100dvh]` / fixed GPU layers, leaving the central gravitational synthesis core unobstructed.
- **Strict `4px` / `8px` Spatial Grid:** Padding (`8px`, `12px`, `16px`) and element gaps (`4px`, `8px`, `12px`) snap strictly to multiples of `4px`.
- **Tabular Alignment:** Multi-row feed health and adapter status lists use CSS Grid tabular columns (`1fr auto auto`) with right-aligned `tabular-nums` latency and signal counts.

## 6. Motion & Interaction
- **GPU-Only Compositing:** All pooled hologram positions (`Slot 0`–`Slot 5`) and sliding segmented indicators animate strictly via `transform: translate3d(...)` and `opacity` (`will-change: transform, opacity`), preserving `0.000` CLS and `<16ms` frame pacing.
- **Weighted Instrument Feel:** Segmented indicator transitions use crisp `cubic-bezier(0.22, 1, 0.36, 1)` (`160ms`) spring-damped curves; `L1–L5` literacy content swaps cross-fade in `90ms` with zero spinners.
- **Live Telemetry Pulse:** Active stream status uses a restrained `6px` `#2DD4BF` / `#34D399` breathing indicator dot rather than distracting full-border flashes.

## 7. Anti-Patterns (Banned)
- **No Emojis in 2D UI Chrome:** Never use emojis (`🔥`, `⚡`, `☄`, `🖼`, `📡`) inside buttons, badges, tabs, or headers—use crisp `12px`–`14px` stroke vector icons (`lucide-react`) or typographic glyphs.
- **No AI Purple/Cyan Neon Button Glows:** Never apply colored outer neon `box-shadow` blooms to 2D buttons, cards, or inputs; reserve glow strictly for the 3D WebGL canvas underneath.
- **No Pill-Button Clutter:** Ban clusters of competing multicolored `rounded-full` pills in toolbars.
- **No `LABEL // SUBTITLE` Clichés:** Replace lazy double-slash AI headers (`CORTEX // OMNISCIENCE`, `ROUTING VERDICT // BANKING`) with clean typographic hierarchy, `1px` vertical dividers, or subtle dot separators (`·`).
- **No Pure Black (`#000000`) Surfaces:** Always use calibrated `Zinc-950` (`#09090B`) or `#0C0C0F` instrument wells.
- **No Jittering Proportional Numbers:** Never render FPS, latency (`ms`), token throughput (`t/s`), prices, or signal counts without `Geist Mono` + `tabular-nums`.
- **No Fabricated Metrics:** Every counter in the HUD and Switchboard reflects live worker/proxy state (`fps`, `workerMs`, `signalsFetched`, `avgLatencyMs`, `itemCount`).
