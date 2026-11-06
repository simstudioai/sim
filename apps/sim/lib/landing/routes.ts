/**
 * Top-level path segments served by the `app/(landing)` route group, plus the
 * root. The single source of truth for "is this the marketing surface", because
 * a route group is not a path prefix and nothing else can derive the answer.
 *
 * Three consumers depend on this list being complete, and all three fail
 * silently when it is not:
 *
 * - `next.config.ts` exempts these paths from COEP. The header is a *document*
 *   header inherited across client-side navigations, so an unlisted landing page
 *   stays cross-origin isolated when it soft-navigates into `/demo`, where the
 *   Cal.com booker then loads uncredentialed and hangs forever.
 * - `ThemeProvider` gives these paths their own theme store, defaulting to
 *   light (the landing family's design baseline) and written only by the
 *   landing footer's toggle, instead of the app's account-synced `system`
 *   default. Leave one out and a visitor on a dark OS lands on a dark
 *   marketing page.
 * - The proxy marks these paths, and the marketing documents in
 *   {@link isMarketingPath}, `noindex` on self-hosted deployments, so a
 *   third-party copy of the marketing site never competes with sim.ai in search
 *   or answer engines. Leave one out and that page stays indexable there.
 *
 * Imported by `next.config.ts` before the `@/` alias resolves, so this module
 * must stay dependency-free.
 *
 * Add every new `app/(landing)` route here.
 */
export const LANDING_ROUTES = [
  'blog',
  'careers',
  'changelog',
  'comparisons',
  'contact',
  'cookie-policy',
  'customers',
  'demo',
  'enterprise',
  'files',
  'integrations',
  'knowledge',
  'library',
  'logs',
  'models',
  'platform',
  'pricing',
  'privacy',
  'solutions',
  'tables',
  'terms',
  'workflows',
] as const

const LANDING_SEGMENTS: ReadonlySet<string> = new Set(LANDING_ROUTES)

/** Whether a pathname is the root or sits under an `app/(landing)` segment. */
export function isLandingPath(pathname: string): boolean {
  const firstSegment = pathname.split('/')[1]
  return firstSegment === '' || LANDING_SEGMENTS.has(firstSegment)
}

/**
 * Root-level documents that republish the marketing site's content for crawlers
 * and answer engines. They are served outside `app/(landing)`, so
 * {@link isLandingPath} does not cover them.
 */
const MARKETING_DOCUMENT_PATHS: ReadonlySet<string> = new Set([
  '/index.md',
  '/llms.txt',
  '/llms-full.txt',
  '/changelog.xml',
])

/** Top-level route segments that republish landing content as documents, e.g. `/library.md/<slug>`. */
const MARKETING_DOCUMENT_SEGMENTS: ReadonlySet<string> = new Set(['library.md'])

/** Whether a pathname serves marketing content: a landing page or a marketing document. */
export function isMarketingPath(pathname: string): boolean {
  return (
    isLandingPath(pathname) ||
    MARKETING_DOCUMENT_PATHS.has(pathname) ||
    MARKETING_DOCUMENT_SEGMENTS.has(pathname.split('/')[1])
  )
}
