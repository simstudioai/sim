import 'server-only'
import { cache } from 'react'
import { createLogger } from '@sim/logger'
import { getOrganizationSurfaceContract } from '@/lib/api/contracts/organization'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { readOrganizationSurface as readOrganizationSurfaceUseCase } from '@/lib/organizations/application/surface'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { asRouteResponse, readSessionViewer } from '@/platform/lib/data/server-read'

const logger = createLogger('PlatformSurface')

type OrganizationSurfaceResult =
  | { status: 'ok'; organization: PlatformOrganization }
  | { status: 'unauthenticated' | 'denied' | 'unavailable' }

/**
 * The viewer's surface in `organizationId`, or in their landing organization when none is named,
 * shared by the layout and every page under it in one request. An organization the viewer does not
 * belong to is `denied`. `unavailable` is a failed read, which must never render as an empty
 * organization.
 */
export const readOrganizationSurface = cache(
  async (organizationId?: string): Promise<OrganizationSurfaceResult> => {
    try {
      const viewer = await readSessionViewer()
      if (!viewer) return { status: 'unauthenticated' }
      const surface = await asRouteResponse(
        getOrganizationSurfaceContract,
        await readOrganizationSurfaceUseCase.execute({
          principal: viewer.principal,
          input: { organizationId },
        })
      )
      return {
        status: 'ok',
        organization: { ...surface, legacyOrigin: getBaseUrl(), routePrefix: '' },
      }
    } catch (error) {
      if (error instanceof OrganizationMembershipNotFoundError) return { status: 'denied' }
      logger.error('Could not read the organization surface', { error })
      return { status: 'unavailable' }
    }
  }
)

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
