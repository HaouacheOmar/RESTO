# RESTO — Design System

Visual and interaction rules for every RESTO screen: the public landing page first, then each role's space. Tokens live in [`client/src/index.css`](../client/src/index.css); components use tokens, never raw hex values.

## 1. Direction: modern chic

A dinner-by-candlelight mood: warm near-black surfaces, ivory paper, a single gold accent, generous whitespace and an editorial serif. Calm, confident, never loud.

| Keep | Avoid |
| :--- | :--- |
| Warm ink and ivory, one gold accent | Bright reds, saturated block colours, gradients as decoration |
| Editorial serif headings, airy body text | Several display fonts, all-caps paragraphs |
| Real, high-quality food and room photography | Stock illustrations, emoji, low-resolution or generic images |
| Slow, soft reveals | Bouncy overshoot, spinning, parallax on everything |
| A typographic menu (name, dotted leader, price) | Photo grids for every dish |

**Sources.** Generated with the UI/UX Pro Max design-system search (`restaurant fine dining elegant chic`, variance 6, motion 5, density 3). Two deliberate deviations from that output:
- **Palette**: its "Vibrant & Block-based" style with an appetising red (`#DC2626`) suits fast food, not "chic". The palette is the database's **Luxury/Premium** one (warm black `#1C1917` + gold `#A16207`), extended with a champagne gold for dark surfaces.
- **Motion**: its stagger preset uses `back.out(1.4)` overshoot. A refined restaurant reads better with soft, non-overshooting ease-out curves (Motion's guidance: overshoot only for playful interfaces).

Kept as generated: typography (Playfair Display SC + Karla, "restaurant, culinary, elegant"), spacious density, the anti-patterns (low-quality imagery, outdated opening hours) and the pre-delivery checklist.

## 2. Colour

| Token | Value | Use | Contrast |
| :--- | :--- | :--- | :--- |
| `--color-ink` | `#1C1917` | Dark sections, header, primary dark button | — |
| `--color-ink-soft` | `#292524` | Footer, raised dark surfaces | — |
| `--color-ivory` | `#FAFAF9` | Page background | — |
| `--color-cream` | `#F5F0E8` | Alternating warm section (Plat du jour) | — |
| `--color-text` | `#0C0A09` | Body text on light | 18.9:1 on ivory |
| `--color-text-muted` | `#57534E` | Secondary text on light | 7.3:1 on ivory |
| `--color-on-dark` | `#FAFAF9` | Text on ink | 17:1 on ink |
| `--color-on-dark-muted` | `#D6D3D1` | Secondary text on ink | 11.6:1 on ink |
| `--color-gold` | `#A16207` | Accent **on light** (eyebrows, prices, icons) | 4.7:1 on ivory |
| `--color-champagne` | `#D4A64A` | Accent **on dark**, gold button fill | 7.7:1 on ink; ink text on it 7.7:1 |
| `--color-border` / `--color-border-dark` | `#D6D3D1` / ivory 14 % | Hairlines | — |
| `--color-focus` | `#D4A64A` | Focus ring | visible on both surfaces |

Rules:
- One accent per screen area. Gold is for emphasis (eyebrow, price, italic word in a headline), never for body text.
- Use `--color-gold` on light surfaces and `--color-champagne` on dark ones: gold on ink fails contrast (3.5:1).
- Status colours, for light surfaces only:

| Token | Value | Use | Contrast |
| :--- | :--- | :--- | :--- |
| `--color-danger` | `#B42318` | Field and form errors, offline state | 6.6:1 on white |
| `--color-danger-soft` | `#FDF0EE` | Background of a form-level error | — |
| `--color-success` | `#15803D` | "Live" connection state, confirmations | 5.0:1 on white |

  Never rely on colour alone: an error always has text, a status always has a label.

## 3. Typography

| Role | Font | Token | Notes |
| :--- | :--- | :--- | :--- |
| Display / headings | Playfair Display 400, italic for one emphasised phrase | `--font-display` | `text-wrap: balance`, line-height 1.1 |
| Eyebrows, logo, labels | Playfair Display SC, letter-spacing 0.18–0.24em | `--font-display-sc` | Small caps, never full sentences |
| Body, UI, buttons | Karla 400–700 | `--font-body` | 16px base, line-height 1.6 |

Scale (fluid with `clamp`): `--text-xs` 13 · `--text-sm` 15 · `--text-base` 16 · `--text-lg` 19 · `--text-xl` 24 · `--text-2xl` 28→40 · `--text-3xl` 36→60 · `--text-hero` 44→92 px.

Buttons are Karla 600, uppercase, letter-spacing 0.08em. Body text is never below 15px and never all caps.

## 4. Space, layout, shape

- **Spacing**: `--space-1…24` (4 → 96 px) plus `--space-section` (72 → 136 px fluid) between sections. Spacious density: when in doubt, add air.
- **Container**: `--container` 1200px with a fluid `--gutter` (20 → 48 px). Everything aligns on the container edge, including the hero text.
- **Grid**: one column on mobile; two columns from 900px for split sections (image 5fr / text 6fr), three columns from 768px for value strips.
- **Shape**: square-ish (`--radius-sm` 2px). Pills only for tiny indicators. Elevation is one soft shadow (`--shadow-soft`) on photographs, never on text cards.
- **Breakpoints to verify**: 375, 768, 1024, 1440 px. No horizontal scroll.

## 5. Components

| Component | Spec |
| :--- | :--- |
| `.btn-gold` | Champagne fill, ink text. The single primary action of a section. Hover: ivory fill. |
| `.btn-ink` | Ink fill on light sections. Hover: gold fill. |
| `.btn-ghost-light` / `.btn-outline` | Secondary action on dark / light surfaces. |
| Buttons (all) | Min height 48px (touch), visible focus ring, colour transitions 260ms. |
| Eyebrow + ornament | Small-caps label with hairlines on both sides; introduces a section. |
| Section head | Eyebrow → serif title → one muted sentence, centred, max 36rem. |
| Menu list | Dish name (serif) · dotted leader · price (champagne, 600) · one-line description. Two columns from 900px. |
| Header | Fixed; transparent over the hero, ink with blur after 80px of scroll. Logo + ≤ 4 anchor links + one gold CTA. Links collapse below 900px (CTA stays). |
| Icons | Lucide, stroke 1.25, gold, `aria-hidden` when next to a text label. No emoji. |
| Skeleton | Warm cream gradient block, same size as the content it replaces (no layout shift). |

## 6. Imagery

- Photographs only: candlelit tables, the dining room, the chef at work. Warm, low-key lighting that matches the ink palette.
- Served from Unsplash with `srcset` (800/1400/2000w), `loading="lazy"` below the fold, `fetchpriority="high"` for the hero, explicit `width`/`height` or `aspect-ratio` to avoid layout shift.
- Text over a photo always sits on a scrim (ink gradient) strong enough to keep 4.5:1.
- Meaningful photos get French alt text; decorative ones (the hero backdrop) get `alt=""`.

## 7. Motion

Library: **Motion for React** (`motion/react`), never `framer-motion`. Primitives in [`client/src/motion.ts`](../client/src/motion.ts) and [`Reveal.tsx`](../client/src/Reveal.tsx).

| Principle | Rule |
| :--- | :--- |
| Feel | Soft and unhurried: `EASE = cubic-bezier(0.22, 1, 0.36, 1)`, no overshoot. |
| Durations | Hover/colour 180–260ms · reveals 800ms · hero image 1.6s. Exits faster than entrances. |
| What moves | `opacity` and `transform` only (GPU-friendly, WAAPI). Never width, height, top or margins. |
| Entrance | Hero: staggered rise (0.12s apart, 0.3s delay) + the photo settling from scale 1.08 to 1. |
| Scroll | `<Reveal>` wraps a group; its children use the `rise` variant (fade + 24px rise), once, at 25 % visibility. Lists stagger 0.05s. |
| Parallax | Hero photo only, max 16 % drift, disabled under reduced motion. |
| Ambient | One infinite animation at most (the scroll cue), CSS, removed under reduced motion. |
| Reduced motion | `<MotionConfig reducedMotion="user">` at the root: transforms are skipped, fades kept. Parallax checks `useReducedMotion()`. Smooth scroll is disabled. |

## 8. Accessibility checklist

- [x] Text contrast ≥ 4.5:1 (see the colour table).
- [x] Visible focus ring (`:focus-visible`, champagne, 3px offset) and a skip link.
- [x] Touch targets ≥ 44px; nav links padded vertically.
- [x] Landmarks: `header`, labelled `nav`, `main`, labelled sections, `footer`; one `h1`.
- [x] Icons are decorative (`aria-hidden`) next to visible labels; no icon-only buttons.
- [x] Loading and error states announced with `role="status"`.
- [x] `prefers-reduced-motion` respected; no content depends on animation.
- [x] `lang="fr"`, prices and dates formatted with `Intl` (`fr-DZ`, DZD).

## 9. Landing page structure

Hero-centric pattern (the database's closest match; no restaurant-specific landing pattern was found):

1. **Hero**: full-bleed candlelit photo, eyebrow, two-line headline with an italic gold phrase, one sentence, primary CTA *Réserver une table* + secondary *Découvrir la carte*.
2. **Values strip**: Salon VIP · Plat du jour · Livraison.
3. **Plat du jour**: chef photo + today's dish, **live** from the API.
4. **La Carte**: dark typographic menu, **live** (only dishes currently available).
5. **Salon VIP**: text + dining-room photo, key facts.
6. **Réservation**: dark CTA band (create a client space, phone) with opening hours, address, delivery.
7. **Footer**: logo, copyright, link to the personal space.

## 10. Data access

- The frontend only calls its own origin; in development Vite proxies `/api`, `/media` and `/ws` to Django.
- API paths are declared **only** in [`client/src/api.ts`](../client/src/api.ts) (`ENDPOINTS`); components call `api('menu')`, never a raw `/api/...` string.
- The URLs remain visible in the browser's network tab; access control stays on the backend (JWT + roles).
