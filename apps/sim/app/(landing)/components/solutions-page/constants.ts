/**
 * Solutions-layout spacing - the single source of truth for every gutter, gap,
 * inset, and reserved dimension used across the solutions-page components.
 *
 * The padding fortress lives here. No solutions component accepts a `className`,
 * `style`, or any layout-override prop, and none hard-codes a spacing value
 * inline. Every measurement a reviewer might want to audit - the horizontal
 * gutter, the inter-section rhythm, the card-grid gaps, the card stack, and the
 * fixed visual-slot dimensions - is named in this one file. To change spacing
 * you edit a constant here; a consumer page literally cannot reach it.
 *
 * All values are Tailwind class fragments (not raw numbers) so they compose
 * directly into `className` strings inside the components and stay legible.
 */
export const SOLUTIONS_SPACING = {
  /**
   * The one horizontal gutter, owned solely by `SolutionsPage`. Matches the
   * navbar and landing hero exactly (`px-20 max-lg:px-8 max-sm:px-5`) so
   * solutions content starts on the wordmark's vertical line at every
   * breakpoint. Sections and cards never set their own gutter.
   */
  gutter: 'px-20 max-lg:px-8 max-sm:px-5',
  /**
   * Inter-section vertical rhythm - the gap of the `<main>` flex column that
   * `SolutionsPage` owns. Sections carry no vertical margin/padding of their own,
   * so this is the only knob for the space between the hero, logos, and every
   * card row. Tightens on smaller screens in lockstep with the landing `<main>`
   * (`gap-[120px] max-lg:gap-[88px] max-sm:gap-16`).
   */
  sectionRhythm: 'gap-[120px] max-lg:gap-[88px] max-sm:gap-16',
  /** Hero text top padding, matching the landing hero (`pt-[112px] max-sm:pt-12`). */
  heroTopPadding: 'pt-[112px] max-sm:pt-12',
  /** Vertical stack gap inside the hero header column (headline → description → CTA). */
  heroStack: 'gap-[22px]',
  /** Gap between the hero header column and the full-width hero visual beneath it. */
  heroToVisual: 'gap-12',
  /** Gap between a card row's header block and the card grid beneath it. */
  cardRowHeaderToGrid: 'gap-12',
  /** Vertical stack gap inside a card row's header (title → subtitle → CTA). */
  cardRowHeaderStack: 'gap-5',
  /** Gap between cards within a card-row grid (both axes). */
  cardGridGap: 'gap-8',
  /** Minimum gap between a card's text block and its visual panel. */
  cardTextToVisual: 'gap-5',
  /** Vertical stack gap inside a card's text block (title → description). */
  cardTextStack: 'gap-2',
} as const

/**
 * Reserved fixed dimensions for the component-owned visual frames. A dropped-in
 * `ReactNode` renders into a frame of exactly these dimensions, so it can never
 * shift surrounding layout (CLS = 0) nor change its own frame padding. The node
 * fills `h-full w-full` inside; it owns nothing about the frame.
 */
export const SOLUTIONS_VISUAL = {
  /** Full-width hero visual aspect ratio - reserves height before paint. */
  heroAspect: 'aspect-[16/9]',
  /** Fixed height of a card's visual panel - uniform across every card. */
  cardHeight: 'h-[240px]',
} as const
