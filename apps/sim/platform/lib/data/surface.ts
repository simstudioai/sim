import 'server-only'
import { cache } from 'react'
import { createLogger } from '@sim/logger'
import { getOrganizationSurfaceContract } from '@/lib/api/contracts/organization'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { readOrganizationSurface as readOrganizationSurfaceUseCase } from '@/lib/organizations/application/surface'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { asRouteResponse, readSessionViewer } from '@/platform/lib/data/server-read'
import { readShellOrganizationId } from '@/platform/lib/data/shell-scope'

const logger = createLogger('PlatformSurface')

type OrganizationSurfaceResult =
  | { status: 'ok'; organization: PlatformOrganization }
  | { status: 'unauthenticated' | 'denied' | 'unavailable' }

/**
 * The viewer's surface in `organizationId`, shared by the layout and every page under it in one
 * request. An organization the viewer does not belong to is `denied`. `unavailable` is a failed
 * read, which must never render as an empty organization.
 */
const readSurfaceIn = cache(
  async (organizationId: string | undefined): Promise<OrganizationSurfaceResult> => {
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
        organization: { ...surface, routePrefix: `/o/${surface.organization.id}` },
      }
    } catch (error) {
      if (error instanceof OrganizationMembershipNotFoundError) return { status: 'denied' }
      logger.error('Could not read the organization surface', { error })
      return { status: 'unavailable' }
    }
  }
)

/**
 * The viewer's surface in `organizationId`, or, when none is named, in the organization this
 * request's shell belongs to (`readShellOrganizationId`), else in the one they land in.
 */
export async function readOrganizationSurface(
  organizationId?: string
): Promise<OrganizationSurfaceResult> {
  return readSurfaceIn(organizationId ?? (await readShellOrganizationId()))
}
