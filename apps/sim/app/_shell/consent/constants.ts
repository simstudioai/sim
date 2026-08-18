/**
 * Consent runtime configuration. Hosted-only, so the backend URL is a constant
 * next to the GTM/GA container IDs it governs rather than an environment
 * variable a self-hosted deployment would never set.
 */
export const CONSENT_BACKEND_URL = 'https://sim-sim.inth.app' as const

/**
 * Categories offered in the banner, in display order. `necessary` is always
 * granted and rendered as a locked row so the list reads complete.
 */
export const CONSENT_CATEGORIES = ['necessary', 'measurement', 'marketing'] as const

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number]

/** Membership test for the categories we render, keyed off the runtime's wider union. */
export const CONSENT_CATEGORY_SET: ReadonlySet<string> = new Set(CONSENT_CATEGORIES)

interface ConsentCategoryCopy {
  title: string
  description: string
}

/**
 * Sim's own wording for each category. The runtime ships generic descriptions;
 * these say what the cookies actually do here.
 */
export const CONSENT_CATEGORY_COPY: Record<ConsentCategory, ConsentCategoryCopy> = {
  necessary: {
    title: 'Necessary',
    description: 'Keeps you signed in and the workspace secure. Always on.',
  },
  measurement: {
    title: 'Analytics',
    description: 'Shows us how Sim is used so we can make it better.',
  },
  marketing: {
    title: 'Marketing',
    description: 'Measures which campaigns bring builders to Sim.',
  },
}
