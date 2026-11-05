import type { ConsentCategory } from '@/lib/consent/constants'

interface ConsentCategoryCopy {
  title: string
  description: string
}

/**
 * Sim's own wording per category. The runtime ships generic descriptions; these
 * say what the cookies actually do here.
 *
 * Typed by name rather than by {@link ConsentCategory} because the runtime's
 * union is wider than the three categories we configure — a policy that adds
 * one server-side falls back to the runtime's description instead of
 * disappearing. The `satisfies` still requires an entry for each of ours.
 */
export const CONSENT_CATEGORY_COPY: Record<string, ConsentCategoryCopy | undefined> = {
  necessary: {
    title: 'Necessary',
    description: 'Sign-in and security. Always on.',
  },
  measurement: {
    title: 'Analytics',
    description: 'Shows us how Sim is used so we can make it better.',
  },
  marketing: {
    title: 'Marketing',
    description: 'Measures campaigns and personalizes ads on other sites.',
  },
} satisfies Record<ConsentCategory, ConsentCategoryCopy>
