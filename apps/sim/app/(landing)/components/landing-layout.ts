/** Shared centered width used by the landing navbar and every primary section. */
export const LANDING_CONTENT_WIDTH = 'mx-auto w-full max-w-[1460px]'

/** Shared responsive horizontal gutter used across the landing family. */
export const LANDING_GUTTER = 'px-20 max-sm:px-5 max-lg:px-8'

/** Shared responsive top clearance for the first landing hero beneath the navbar. */
export const LANDING_HERO_TOP_PADDING = 'pt-[112px] max-sm:pt-12 max-xl:pt-20'

/** Shared vertical rhythm between top-level landing sections. */
export const LANDING_SECTION_RHYTHM = 'gap-[120px] max-sm:gap-16 max-lg:gap-[88px]'

/**
 * Extra top separation for a hero CTA over the hero stack gap. Headline and
 * description are one copy group and keep the tight 22px stack gap; the CTA is
 * a separate action group, so its description→CTA gap lands at 34px (22 + 12),
 * roughly 1.5× the headline→description gap.
 */
export const LANDING_HERO_CTA_GAP = 'mt-3'
