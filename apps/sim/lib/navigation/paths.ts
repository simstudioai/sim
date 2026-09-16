/**
 * Top-level destinations of the signed-in app. Dependency-free so the edge proxy,
 * server components, and client code all read the same values.
 */

/**
 * Where an authenticated viewer lands when nothing more specific was asked for:
 * after login, from `/`, and from every "open Sim" affordance. A server route
 * that resolves to the viewer's organization surface, or to their workspaces when
 * they belong to no organization. Every default post-auth destination must point
 * here rather than at a concrete surface, so the landing decision lives in one place.
 */
export const APP_ENTRY_PATH = '/home'

/**
 * The workspace picker: resolves to the viewer's most recent workspace. Use it only
 * where the viewer explicitly asked for workspaces; the default landing is
 * {@link APP_ENTRY_PATH}.
 */
export const WORKSPACES_PATH = '/workspace'

/** Opens full settings in the viewer's most recent accessible workspace. */
export const WORKSPACE_SETTINGS_PATH = `${WORKSPACES_PATH}?redirect=settings`

/** Root of the organization surface; `/o` alone resolves like {@link APP_ENTRY_PATH}. */
const ORGANIZATIONS_PATH = '/o'

/**
 * Every destination under one organization's surface, built from one place so the
 * sidebar, redirects, and pages can never disagree about a path.
 */
export function organizationRoutes(organizationId: string) {
  const root = `${ORGANIZATIONS_PATH}/${organizationId}`
  return {
    root,
    home: `${root}/home`,
    search: `${root}/search`,
    integrations: `${root}/integrations`,
    skills: `${root}/skills`,
    settings: `${root}/settings`,
    searchProvider: (connectorType: string) =>
      `${root}/settings/integrations/providers/${encodeURIComponent(connectorType)}`,
    searchSource: (connectorId: string) =>
      `${root}/settings/integrations/sources/${encodeURIComponent(connectorId)}`,
    settingsSection: (section: string) => `${root}/settings/${section}`,
    chat: (chatId: string) => `${root}/chat/${chatId}`,
  } as const
}

function isPathOrDescendant(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`)
}

/**
 * Whether a pathname belongs to the signed-in app — the entry, the workspaces, or
 * the organization surface — and so requires a session before it renders.
 */
export function isAppSurfacePath(pathname: string): boolean {
  return (
    isPathOrDescendant(pathname, APP_ENTRY_PATH) ||
    isPathOrDescendant(pathname, WORKSPACES_PATH) ||
    isPathOrDescendant(pathname, ORGANIZATIONS_PATH)
  )
}
