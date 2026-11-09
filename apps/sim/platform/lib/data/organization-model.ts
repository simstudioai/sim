import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'

/** What every organization route's path needs in front of it: `/o/<organizationId>`. */
export interface SurfaceScope {
  routePrefix: string
}

/** The organization surface as Platform views read it. Plain data: it crosses from the server. */
export type PlatformOrganization = OrganizationSurfaceResponse & SurfaceScope

/** An organization route: `path` (`/home`, `/settings/members`, ...) under the scope's prefix. */
export function surfaceHref({ routePrefix }: SurfaceScope, path: string): string {
  return `${routePrefix}${path}`
}

/** Where a viewer outside the organization goes instead: their workspaces. */
export const OUTSIDE_ORGANIZATION_HREF = WORKSPACES_PATH

/** The legacy sidebar's rule for its Chats section; the list read answers 403 outside it. */
export function canListOrganizationChats(organization: PlatformOrganization): boolean {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  return mothershipAvailable && (canBuild || searchAccess.memberScoped)
}
