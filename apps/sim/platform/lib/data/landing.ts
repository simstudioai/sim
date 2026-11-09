import { organizationRoutes, WORKSPACE_SETTINGS_PATH, workspacePath } from '@/lib/navigation/paths'
import {
  type PlatformOrganization,
  resolveHomeRedirect,
  surfaceHref,
} from '@/platform/lib/data/organization-model'
import { resolveSettingsAlias } from '@/platform/lib/data/settings-navigation'
import { platformHref } from '@/platform/lib/navigation'
import { workspaceHome, workspaceLocation } from '@/platform/lib/workspace-navigation'

/**
 * Where an organization's bare URL sends a viewer: the legacy organization root's priority chain.
 * Links is a Settings section here.
 */
export function organizationLandingPath(organization: PlatformOrganization): string {
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const routes = organizationRoutes(organization.organization.id)
  if (mothershipAvailable && canBuild) return routes.home
  if (searchAccess.memberScoped) return routes.search
  if (navFlags.people) return routes.people
  return navFlags.simLinks ? routes.simLinks : WORKSPACE_SETTINGS_PATH
}

/** The path and query a document request opens. */
export interface ShellLocation {
  pathname: string
  query: URLSearchParams
}

/**
 * The redirect a document request for an organization's bare URL, its Home, a Settings alias, or a
 * workspace's bare URL answers. The shell applies it before anything streams, so the viewer gets
 * one HTTP redirect instead of a painted page that navigates again once loaded; the pages keep the
 * same gates for client navigations.
 */
export function resolveEntryRedirect(
  organization: PlatformOrganization,
  location: ShellLocation | null
): string | null {
  if (!location) return null
  const { pathname, query } = location
  const workspace = workspaceLocation(pathname)
  if (workspace && pathname.split('/').length === 3)
    return platformHref(workspacePath(workspace.id, workspaceHome('live')), query)
  if (pathname === organization.routePrefix) return organizationLandingPath(organization)
  if (pathname === surfaceHref(organization, '/home')) return resolveHomeRedirect(organization)
  const settingsPrefix = `${surfaceHref(organization, '/settings')}/`
  if (pathname.startsWith(settingsPrefix))
    return resolveSettingsAlias(
      organization,
      pathname.slice(settingsPrefix.length).split('/'),
      query
    )
  return null
}
