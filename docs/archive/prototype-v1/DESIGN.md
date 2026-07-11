# Echo/Rewind — Design System (Amber)

> **Status: historical prototype-v1 document.**
>
> This file records the design system of `prototype-v1` (`4147372`). It is preserved as historical evidence and is not active reconstruction guidance. See `docs/PRODUCT_BRIEF.md` for the canonical product definition.

## Philosophy

The app should feel: **warm dark, temporal, calm, precise, premium, technical, restrained.**

Metaphor: a code room with memory. The timeline feels like a film strip or a session afterglow. Past mode is a cooler, quieter world — the present is warm.

Avoid:
- Generic Tailwind blue
- Default shadcn look
- Fake AI gradients
- Heavy glassmorphism
- Playful toy coding app vibes
- Busy IDE chrome
- Replit or CodeSandbox clone visuals
- Overloaded dashboards

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0D0B09` | Page background |
| `--panel` | `#161310` | Editor container, footer |
| `--panel-strong` | `#1E1A14` | Header, inner surfaces |
| `--border` | `#2A2318` | Primary borders |
| `--border-subtle` | `#1F1B14` | Dividers, subtle separators |
| `--text` | `#E8E0D0` | Primary readable text |
| `--muted` | `#7A6850` | Secondary text, labels, line numbers |
| `--accent` | `#F5A623` | Amber accent — markers, logo, highlights |
| `--presence-teal` | `#5BB8A0` | User B / second presence color |
| `--success` | `#6FCF97` | Live green — connection dot, now marker |
| `--past` | `#5A8FB5` | Temporal blue — past mode accents |
| `--past-bg` | `#08090F` | Editor background in past mode |
| `--editor-bg` | `#0F0D0B` | Editor background in live mode |
| `--editor-text` | `#D4C9B4` | Editor code text |
| `--editor-line` | `#3A3020` | Line number text |
| `--timeline-bg` | `#0E0C0A` | Timeline track background |

User presence colors rotate through: `#F5A623` (amber), `#5BB8A0` (teal), `#A78BFA` (violet), `#F87171` (rose), `#34D399` (emerald).

## Typography

- **UI font**: system-ui / `-apple-system` stack, no custom web font needed for v1
- **Mono font**: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas` — for the editor and code snippets
- **Base size**: 14 px body, 13 px editor, 12 px labels, 10 px micro-labels
- **Weight**: 400 body, 500 UI labels, 600 presence initials

## Spacing & Layout

- Page grid: `grid-rows-[36px_1fr_52px]` — top bar / editor / timeline footer
- Top bar: `h-[36px]`, `px-4`
- Editor area: fills remaining space, no outer padding card, no filename tab bar
- Timeline footer: `h-[52px]`, `px-4 py-2`
- Border radius: `rounded-md` (8 px) for pills and surface insets, `rounded-full` for avatars

## Component Inventory

### AppShell
Three-row grid. Header, editor area, footer. The editor area uses a subtle radial gradient to add warmth without competing with the code.

### Header
Left: Echo/Rewind logo mark (Clock3 icon in amber) + room name. Right: `PresenceBar` + `ConnectionStatus`.

### PresenceBar
Stacked avatar circles (`-space-x-2`), each showing a colored initial. Tooltip shows full name and status. In live mode shows "N present" count.

### ConnectionStatus
Rounded pill with live/connecting/offline state. Live state: pulsing green dot + Wifi icon + "Synced".

### CollaborativeEditor
Full-height CodeMirror 6 view. The editor owns the screen — no filename tab bar, no output pane, no surrounding chrome. Line numbers in `--muted`. Selection highlight uses user accent color at low opacity.

### TimelineScrubber
Single-row track. The timeline uses a minimal amber rail with ticked event markers. Marker color can reflect the author color. The right edge is now. It should feel like session memory, not a media player. Hover tooltip: relative time. Draggable scrubber thumb.

### Past Mode Pill
Fixed overlay inside the editor area, bottom-center or top-right. Text: "Viewing the past · 3 min ago". Background: `--past-bg` with `--past` border. "Return to now" sits adjacent or just below.

## Motion

Use Framer Motion only for:
- Marker entry animation (fade + slight translate-y)
- Past mode transition (background color crossfade ~200 ms)
- Pill appear/disappear (fade)
- Avatar enter/exit in PresenceBar (scale + opacity)

Do not animate: the editor content, the scrubber thumb physics, cursor blinks.

## Past Mode Visual Contract

When entering past mode:
1. Editor background transitions from `--editor-bg` to `--past-bg`
2. A cool blue tint overlays the editor border
3. The pill appears
4. Remote cursors ghost (opacity 0.3) or disappear
5. The "Return to now" button appears

The user must never be confused about whether they are in the past or the present. The visual shift must be unmistakable.
