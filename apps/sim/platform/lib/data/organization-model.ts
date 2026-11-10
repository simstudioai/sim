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

/** The sidebar lists chats for whoever may use chat; the list read refuses anyone else. */
export function canListOrganizationChats(organization: PlatformOrganization): boolean {
  return organization.mothershipAvailable
}
