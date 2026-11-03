import { isPathOrDescendant } from '@/lib/navigation/paths'

const AUTH_SURFACE_ROOTS = [
  '/login',
  '/signup',
  '/verify',
  '/reset-password',
  '/sso',
  '/oauth',
  '/oauth-error',
  '/invite',
  '/enterprise/claim',
  '/unsubscribe',
  '/desktop/auth',
  '/desktop/done',
  '/desktop/connect',
  '/cli/auth',
  '/credential-groups',
  '/slack-search',
  '/knowledge/github/setup',
  '/f',
  '/chat',
] as const

/** Routes whose account or resource-access UI is governed by the isolated Auth system. */
export function isAuthSurfacePath(pathname: string): boolean {
  return AUTH_SURFACE_ROOTS.some((root) => isPathOrDescendant(pathname, root))
}
