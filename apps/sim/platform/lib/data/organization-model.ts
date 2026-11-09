import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import { resourceParam } from '@/lib/mothership/chat/search-params'
import { WORKSPACE_SETTINGS_PATH, WORKSPACES_PATH } from '@/lib/navigation/paths'

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

/** The legacy surface's rule for when a member has nothing of theirs on the organization surface. */
function hasOrganizationSurface(organization: PlatformOrganization): boolean {
  const { mothershipAvailable, searchAccess, navFlags } = organization
  return mothershipAvailable || searchAccess.memberScoped || navFlags.people || navFlags.simLinks
}

/** Where a member with nothing of theirs on the organization surface goes: workspace Settings. */
export function resolveSurfaceRedirect(organization: PlatformOrganization): string | null {
  return hasOrganizationSurface(organization) ? null : WORKSPACE_SETTINGS_PATH
}

/** The legacy sidebar's rule for its Chats section; the list read answers 403 outside it. */
export function canListOrganizationChats(organization: PlatformOrganization): boolean {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  return mothershipAvailable && (canBuild || searchAccess.memberScoped)
}

/**
 * The legacy Home page's gate: a member who cannot build goes to Search, otherwise to Settings.
 * Legacy Home was a new chat with a resource panel, so a builder's address that opens a resource
 * (`?resource=`, with a results tab's `?q=` and filters) goes to the new chat, which owns it now.
 */
export function resolveHomeRedirect(
  organization: PlatformOrganization,
  searchParams: Record<string, string | string[] | undefined>
): string | null {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  if (!mothershipAvailable || !canBuild) {
    return searchAccess.memberScoped
      ? surfaceHref(organization, '/search')
      : WORKSPACE_SETTINGS_PATH
  }
  if (!searchParams[resourceParam.key]) return null
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const entry of [value ?? []].flat()) query.append(key, entry)
  return `${surfaceHref(organization, '/chat')}?${query}`
}
