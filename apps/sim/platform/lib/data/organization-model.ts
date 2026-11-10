import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'

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
