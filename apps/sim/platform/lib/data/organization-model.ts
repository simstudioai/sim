import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'

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

/** The legacy surface's rule for when a member has nothing of theirs on the organization surface. */
export function hasOrganizationSurface(organization: PlatformOrganization): boolean {
  const { mothershipAvailable, searchAccess, navFlags } = organization
  return mothershipAvailable || searchAccess.memberScoped || navFlags.people || navFlags.simLinks
}

/** The legacy sidebar's rule for its Chats section; the list read answers 403 outside it. */
export function canListOrganizationChats(organization: PlatformOrganization): boolean {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  return mothershipAvailable && (canBuild || searchAccess.memberScoped)
}

/** The legacy Home page's gate: a member who cannot build goes to Search, otherwise to Settings. */
export function resolveHomeRedirect(organization: PlatformOrganization): string | null {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  if (mothershipAvailable && canBuild) return null
  return searchAccess.memberScoped ? surfaceHref(organization, '/search') : WORKSPACE_SETTINGS_PATH
}
