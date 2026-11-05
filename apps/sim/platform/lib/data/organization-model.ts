import type { DeploymentShape } from '@/lib/api/contracts'
import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import {
  organizationRoutes,
  WORKSPACE_SETTINGS_PATH,
  WORKSPACES_PATH,
} from '@/lib/navigation/paths'

/** The organization surface as Platform views read it. Plain data: it crosses from the server. */
export interface PlatformOrganization {
  organization: OrganizationSurfaceResponse['organization']
  viewer: OrganizationSurfaceResponse['viewer']
  access: {
    mothershipAvailable: boolean
    canBuild: boolean
    searchAccess: OrganizationSurfaceResponse['searchAccess']
  }
  connectedAccountsAvailable: boolean
  settingsFeatures: OrganizationSurfaceResponse['settingsFeatures']
  deployment: DeploymentShape
  navFlags: OrganizationSurfaceResponse['navFlags']
  featureFlags: OrganizationSurfaceResponse['featureFlags']
  /** Legacy section ids the viewer may reach. Hiding one is navigation, never authorization. */
  settingsSections: readonly string[]
  /** Absolute origin of the main app, for the legacy routes the Platform links out to. */
  legacyOrigin: string
}

export function toPlatformOrganization(
  surface: OrganizationSurfaceResponse,
  legacyOrigin: string
): PlatformOrganization {
  return {
    organization: surface.organization,
    viewer: surface.viewer,
    access: {
      mothershipAvailable: surface.mothershipAvailable,
      canBuild: surface.canBuild,
      searchAccess: surface.searchAccess,
    },
    connectedAccountsAvailable: surface.connectedAccountsAvailable,
    settingsFeatures: surface.settingsFeatures,
    deployment: surface.deployment,
    navFlags: surface.navFlags,
    featureFlags: surface.featureFlags,
    settingsSections: surface.settingsSections,
    legacyOrigin,
  }
}

/**
 * Absolute URLs of the legacy routes the Platform links out to. A full navigation, since `next/link`
 * would add this app's base path. Each is a route the legacy layout does not map back here.
 */
export function legacyRoutes({ legacyOrigin, organization }: PlatformOrganization) {
  const routes = organizationRoutes(organization.id)
  return {
    search: `${legacyOrigin}${routes.search}`,
    searchChat: (chatId: string) => `${legacyOrigin}${routes.searchChat(chatId)}`,
    benchmark: `${legacyOrigin}${routes.benchmark}`,
    settingsSection: (section: string) => `${legacyOrigin}${routes.settingsSection(section)}`,
    workspace: (workspaceId: string) => `${legacyOrigin}${WORKSPACES_PATH}/${workspaceId}`,
    workspaceSettings: `${legacyOrigin}${WORKSPACE_SETTINGS_PATH}`,
  }
}

/** The legacy surface's rule for when a member has nothing of theirs on the organization surface. */
export function hasOrganizationSurface(organization: PlatformOrganization): boolean {
  const { access, navFlags } = organization
  return (
    access.mothershipAvailable ||
    access.searchAccess.memberScoped ||
    navFlags.people ||
    navFlags.simLinks
  )
}
