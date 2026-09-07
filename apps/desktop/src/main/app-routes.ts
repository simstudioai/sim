import { isSafeInternalPath } from '@/main/config'

/**
 * Routes into the Sim web app that the shell navigates to on the user's
 * behalf, from a menu item or a tray item.
 *
 * They live here rather than in either caller because both the tray and the
 * application menu offer the same destinations. Keeping them in `tray.ts` made
 * `index.ts` import tray internals to wire up menu items that have nothing to
 * do with the tray, and the tray can be absent entirely.
 */

/**
 * The web app's signed-in entry. It resolves to the organization the user belongs
 * to, or to their workspaces, so the shell never has to know which applies.
 */
export const APP_ENTRY_ROUTE = '/home'

/** Workspace id from the last visited route, or null when it carries none. */
function workspaceIdFromRoute(lastRoute: string | undefined): string | null {
  if (isSafeInternalPath(lastRoute)) {
    const match = /^\/workspace\/([^/?#]+)/.exec(lastRoute)
    if (match) {
      return match[1]
    }
  }
  return null
}

/**
 * Route for "New Chat": the home (chat) surface of the workspace the user was
 * last in, falling back to the app entry when the last route carries no
 * workspace.
 */
export function newChatRoute(lastRoute: string | undefined): string {
  const workspaceId = workspaceIdFromRoute(lastRoute)
  return workspaceId ? `/workspace/${workspaceId}/home` : APP_ENTRY_ROUTE
}

/**
 * Route for "Settings…": the Sim app's settings surface for the workspace the
 * user was last in, falling back to the app entry.
 */
export function settingsRoute(lastRoute: string | undefined): string {
  const workspaceId = workspaceIdFromRoute(lastRoute)
  return workspaceId ? `/workspace/${workspaceId}/settings/desktop` : APP_ENTRY_ROUTE
}
