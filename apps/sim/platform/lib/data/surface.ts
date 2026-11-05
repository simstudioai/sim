import 'server-only'
import { cache } from 'react'
import { createLogger } from '@sim/logger'
import { isApiClientError } from '@/lib/api/client/errors'
import { getOrganizationSurfaceContract } from '@/lib/api/contracts/organization'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { serverRequestJson } from '@/platform/lib/data/server-request'

const logger = createLogger('PlatformSurface')

type OrganizationSurfaceResult =
  | { status: 'ok'; organization: PlatformOrganization }
  | { status: 'unauthenticated' | 'denied' | 'unavailable' }

/**
 * The viewer's organization surface, shared by the layout and every page under it in one request.
 * `unavailable` is a failed read, which must never render as an empty organization.
 */
export const readOrganizationSurface = cache(async (): Promise<OrganizationSurfaceResult> => {
  try {
    const surface = await serverRequestJson(getOrganizationSurfaceContract, {})
    return { status: 'ok', organization: { ...surface, legacyOrigin: getBaseUrl() } }
  } catch (error) {
    if (isApiClientError(error) && error.status === 401) return { status: 'unauthenticated' }
    if (isApiClientError(error) && error.status === 403) return { status: 'denied' }
    logger.error('Could not read the organization surface', { error })
    return { status: 'unavailable' }
  }
})

/**
 * A main-app URL for a server redirect. Same origin as this page once deployed, but `redirect()`
 * prefixes a relative path with this app's base path, so the URL is absolute.
 */
export function legacyUrl(path: string): string {
  return `${getBaseUrl()}${path}`
}

/**
 * The main app's login, returning here afterward. The callback is the zone root because a layout
 * cannot learn its sub-path; the legacy layout returns to its root the same way.
 */
export function loginUrl(): string {
  const query = new URLSearchParams({
    callbackUrl: process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH || '/',
  })
  return legacyUrl(`/login?${query}`)
}
