/**
 * Shared centered width used by the landing navbar and every primary section.
 *
 * 1728px is Harvey's `max-w-page-width`: wide enough that on a 1440–1920
 * screen the frame is the viewport minus a small gutter, not a 1460px column
 * floating in 80px insets.
 */
export const LANDING_CONTENT_WIDTH = 'mx-auto w-full max-w-[1728px]'

/**
 * Shared responsive horizontal gutter. Matches Harvey's page padding
 * (`px-7` / `md:px-8` / `lg:px-9` / `xl:px-10`) so section edges sit close
 * to the browser. Desktop-first `max-*` equivalents of that scale.
 */
export const LANDING_GUTTER = 'px-10 max-md:px-7 max-lg:px-8 max-xl:px-9'

/** Shared responsive top clearance for the first landing hero beneath the navbar. */
export const LANDING_HERO_TOP_PADDING = 'pt-[112px] max-sm:pt-12 max-xl:pt-20'

/** Shared vertical rhythm between top-level landing sections. */
export const LANDING_SECTION_RHYTHM = 'gap-[120px] max-sm:gap-16 max-lg:gap-[88px]'

/**
 * Homepage-only rhythm. The marketing pages that share
 * {@link LANDING_SECTION_RHYTHM} stay on the original 120px beat; the homepage
 * uses 144 / 96 / 80px between major sections. Related sections are grouped
 * with smaller positive gaps in `Landing`, so their spacing stays independent
 * of this outer rhythm.
 */
export const HOME_SECTION_RHYTHM = 'gap-36 max-sm:gap-20 max-lg:gap-24'

/**
 * Shared 10/12 inset for homepage content. The hero masthead and product
 * preview share this measure so their leading and trailing edges align.
 */
export const HOME_INSET = 'w-full lg:mx-auto lg:w-[83.333%]'

/** Shared chrome for an elevated product window on the homepage. */
export const LANDING_WINDOW_SHADOW =
  'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_0_rgba(0,0,0,0.05),0_4px_42px_0_rgba(0,0,0,0.06)]'

/**
 * Corner radius for full-width painted/product stages (hero, product-demo,
 * connect). Tight enough to read as a product frame rather than a pill.
 */
export const LANDING_STAGE_RADIUS = 'rounded-[12px]'

/**
 * Inner product window nested inside a painted stage. Tighter than
 * {@link LANDING_STAGE_RADIUS} so the nested clip stays inside the outer.
 */
export const LANDING_STAGE_WINDOW_RADIUS = 'rounded-[8px]'

/**
 * Extra top separation for a hero CTA over the hero stack gap. Headline and
 * description are one copy group and keep the tight 22px stack gap; the CTA is
 * a separate action group, so its description→CTA gap lands at 34px (22 + 12),
 * roughly 1.5× the headline→description gap.
 */
export const LANDING_HERO_CTA_GAP = 'mt-3'

/**
 * Shared landing type scale used by platform heroes, `/enterprise`, and
 * marketing subpages. Homepage display sizes live in {@link HOME_TYPE} so a
 * 96px H1 cannot leak onto those pages.
 */
export const LANDING_TYPE = {
  /** The page's single `<h1>`. */
  h1: 'text-[76px] leading-[1.0] tracking-[-0.03em] max-sm:text-[38px] max-xl:text-[56px]',
  /**
   * Homepage proof claim. Harvey's post-hero H2 is 40px, one step quieter
   * than a section headline in the same Season tracking family.
   */
  proof: 'text-[40px] leading-[1.1] tracking-[-0.02em] max-sm:text-[28px] max-xl:text-[34px]',
  /** Primary supporting copy - hero description, section descriptions. */
  lead: 'text-[20px] leading-[1.4] max-sm:text-[17px]',
  /** Secondary copy - sub-feature definitions, list-row descriptions. */
  body: 'text-[16px] leading-[1.45]',
  /** Labels, eyebrows, and meta. */
  meta: 'text-[14px] leading-[1.4]',
} as const

/**
 * Homepage-only type scale. The 80px Season masthead is restrained enough for
 * the wide split composition while the remaining section scale stays unchanged.
 * Isolated from {@link LANDING_TYPE} so `/enterprise` and platform heroes keep
 * their current masthead.
 */
export const HOME_TYPE = {
  /** Homepage `<h1>` - compact display scale for the architectural hero. */
  h1: 'text-[80px] leading-[0.96] tracking-[-0.025em] max-sm:text-[42px] max-xl:text-[64px]',
  /** Centered media / audience `<h2>` - Harvey `text-heading-2` (64px). */
  h2Display: 'text-[64px] leading-[1.05] tracking-[-0.025em] max-sm:text-[36px] max-xl:text-[48px]',
  /** Quieter section `<h2>` - Harvey `text-heading-4` / proof (40px). */
  h2: LANDING_TYPE.proof,
  /** Card titles on the two-window platform row. */
  h3: 'text-[32px] leading-[1.15] tracking-[-0.015em] max-sm:text-[24px]',
  lead: LANDING_TYPE.lead,
  body: LANDING_TYPE.body,
  meta: LANDING_TYPE.meta,
} as const
