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
 * - `ThemeProvider` defaults these paths to the light theme (the landing
 *   family's design baseline) instead of the app's `system` default, while
 *   still honouring a theme the visitor has chosen from the landing footer's
 *   toggle. Leave one out and a first-time visitor on a dark OS lands on a
 *   dark marketing page.
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
  'pricing',
  'privacy',
  'solutions',
  'tables',
  'terms',
  'workflows',
] as const
