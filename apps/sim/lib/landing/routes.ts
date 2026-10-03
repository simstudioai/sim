/**
 * Top-level path segments served by the `app/(landing)` route group, plus the
 * root. The single source of truth for "is this the marketing surface", because
 * a route group is not a path prefix and nothing else can derive the answer.
 *
 * Two consumers depend on this list being complete, and both fail silently when
 * it is not:
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
