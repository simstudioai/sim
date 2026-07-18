/** Reserved path segments / slugs on the apps domain (Interface reserved-identifier lesson). */
export const APP_RESERVED_SLUGS = new Set([
  'a',
  'api',
  'auth',
  'static',
  'assets',
  'health',
  'status',
  'admin',
  'manage',
  'preview',
  'releases',
  'actions',
  '__sim',
  'favicon.ico',
  'robots.txt',
])

export const APP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function isValidAppSlug(slug: string): boolean {
  if (!APP_SLUG_PATTERN.test(slug)) return false
  if (APP_RESERVED_SLUGS.has(slug)) return false
  return true
}
