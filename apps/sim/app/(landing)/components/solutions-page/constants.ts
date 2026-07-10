import {
  LANDING_GUTTER,
  LANDING_HERO_TOP_PADDING,
  LANDING_SECTION_RHYTHM,
} from '@/app/(landing)/components/landing-layout'

/**
 * Solutions-layout spacing - the single source of truth for every gutter, gap,
 * inset, and reserved dimension used across the solutions-page components.
 *
 * The padding fortress lives here. No solutions component accepts a `className`
 * or `style`, and none hard-codes a spacing value inline. Every measurement a
 * reviewer might want to audit - the horizontal gutter, the inter-section rhythm,
 * the card-grid gaps, the card stack, and the fixed visual-slot dimensions - is
 * named in this one file. To change spacing you edit a constant here; consumer
 * pages only choose from controlled component variants.
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
  gutter: LANDING_GUTTER,
  /**
   * Inter-section vertical rhythm - the gap of the `<main>` flex column that
   * `SolutionsPage` owns. Sections carry no vertical margin/padding of their own,
   * so this is the only knob for the space between the hero, logos, and every
   * card row. Tightens on smaller screens in lockstep with the landing `<main>`
   * (`gap-[120px] max-lg:gap-[88px] max-sm:gap-16`).
   */
  sectionRhythm: LANDING_SECTION_RHYTHM,
  /** Hero text top padding, matching the landing hero at every breakpoint. */
  heroTopPadding: LANDING_HERO_TOP_PADDING,
  /** Vertical stack gap inside the hero header column (headline → description → CTA). */
  heroStack: 'gap-[22px]',
  /** Gap between the hero header column and the full-width hero visual beneath it. */
  heroToVisual: 'gap-12',
  /** Gap between a card row's header block and the card grid beneath it. */
  cardRowHeaderToGrid: 'gap-12',
  /** Vertical stack gap inside a card row's header (title → subtitle → CTA). */
  cardRowHeaderStack: 'gap-5',
  /**
   * Extra top separation for the header CTA over the stack gap. Title and
   * subtitle are one copy group and stay tight; the CTA is a separate action
   * group, so its subtitle→CTA gap lands at 2× the title→subtitle gap
   * (standard: 20px + 20px = 40px; feature: 12px + 12px = 24px).
   */
  cardRowHeaderCtaGap: 'mt-5',
  cardRowHeaderCtaGapFeature: 'mt-3',
  /** Gap between cards within a card-row grid (both axes). */
  cardGridGap: 'gap-8',
  /** Minimum gap between a card's text block and its visual panel. */
  cardTextToVisual: 'gap-5',
  /** Vertical stack gap inside a card's text block (title → description). */
  cardTextStack: 'gap-2',
  /** Inner padding for feature tiles where copy and the visual slot share one frame. */
  cardFeatureTilePadding: 'p-8 max-lg:p-6',
} as const

/**
 * Readable text measures for the recurring solutions-page copy surfaces.
 * Paragraph width is expressed in characters so line length tracks type size
 * instead of the viewport. `min-w-0` keeps flex items wrapping cleanly on narrow
 * screens, and `w-full` gives centered copy a stable measure.
 */
export const SOLUTIONS_TEXT_MEASURE = {
  /** Hero support copy: broad enough for the primary value prop, still under long-form prose width. */
  heroDescription: 'w-full min-w-0 max-w-[58ch]',
  /** Section subtitles: slightly tighter than hero copy so centered headers feel intentional. */
  rowSubtitle: 'w-full min-w-0 max-w-[52ch]',
  /** Card descriptions: short scan lines inside three-up card grids. */
  cardDescription: 'min-w-0 max-w-[38ch]',
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
  /** Minimum height for framed feature tiles with copy and future UI in one surface. */
  featureTileMinHeight: 'min-h-[440px] max-lg:min-h-[400px] max-sm:min-h-[380px]',
} as const

/**
 * Feature-tile surface + copy colors. Pages pick a tone per card via
 * {@link SolutionsCardConfig.featureTileTone}; the component maps it here so
 * each tile can diverge without shared hard-coded classes.
 */
export const SOLUTIONS_FEATURE_TILE_TONE = {
  light: {
    surface: 'bg-[var(--surface-3)]',
    title: 'text-[var(--text-primary)]',
    description: 'text-[var(--text-muted)]',
  },
  dark: {
    surface: 'bg-[var(--text-secondary)]',
    title: 'text-[var(--text-inverse)]',
    description: 'text-[var(--surface-3)]',
    /** Softer body copy on dark tiles — `#E6E6E6` via `--surface-6` (`#E5E5E5`). */
    descriptionSoft: 'text-[var(--surface-6)]',
  },
} as const
