import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import {
  organizationRoutes,
  WORKSPACE_SETTINGS_PATH,
  WORKSPACES_PATH,
} from '@/lib/navigation/paths'

/**
 * The organization surface as Platform views read it. Plain data: it crosses from the server.
 * `legacyOrigin` is the main app's absolute origin, for the routes the Platform links out to.
 */
export type PlatformOrganization = OrganizationSurfaceResponse & { legacyOrigin: string }

/**
 * Absolute URLs of the legacy routes the Platform links out to. A full navigation, since `next/link`
 * would add this app's base path. Each is a route the legacy layout does not map back here.
 */
export function legacyRoutes({ legacyOrigin, organization }: PlatformOrganization) {
  const routes = organizationRoutes(organization.id)
  return {
    benchmark: `${legacyOrigin}${routes.benchmark}`,
    settingsSection: (section: string) => `${legacyOrigin}${routes.settingsSection(section)}`,
    workspace: (workspaceId: string) => `${legacyOrigin}${WORKSPACES_PATH}/${workspaceId}`,
    workspaceSettings: `${legacyOrigin}${WORKSPACE_SETTINGS_PATH}`,
  }
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
  return searchAccess.memberScoped ? '/search' : legacyRoutes(organization).workspaceSettings
}
