import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { MenuItemConstructorOptions } from 'electron'
import { app, Menu, nativeImage, session, Tray } from 'electron'
import { isSafeInternalPath } from '@/main/config'

const logger = createLogger('DesktopTray')

const RECENT_CHATS_LIMIT = 5
const CHATS_FETCH_TIMEOUT_MS = 1500
const CHATS_API_PATH = '/api/copilot/chats'

export interface RecentChat {
  id: string
  title: string
  workspaceId: string
}

/**
 * Extracts tray-usable chats from the /api/copilot/chats response. Chats
 * without a workspace id are dropped — the deep link needs one — and the
 * response is already sorted by recency server-side.
 */
export function parseRecentChats(
  payload: unknown,
  limit: number = RECENT_CHATS_LIMIT
): RecentChat[] {
  if (typeof payload !== 'object' || payload === null) {
    return []
  }
  const chats = (payload as { chats?: unknown }).chats
  if (!Array.isArray(chats)) {
    return []
  }
  const result: RecentChat[] = []
  for (const chat of chats) {
    if (result.length >= limit) {
      break
    }
    if (typeof chat !== 'object' || chat === null) {
      continue
    }
    const { id, title, workspaceId } = chat as {
      id?: unknown
      title?: unknown
      workspaceId?: unknown
    }
    if (typeof id !== 'string' || !id || typeof workspaceId !== 'string' || !workspaceId) {
      continue
    }
    result.push({
      id,
      title: typeof title === 'string' && title.trim() ? title.trim() : 'Untitled chat',
      workspaceId,
    })
  }
  return result
}

/**
 * Route for a tray-initiated "New Chat": the home (chat) surface of the
 * workspace the user was last in, falling back to the workspace picker
 * redirect when the last route carries no workspace.
 */
export function newChatRoute(lastRoute: string | undefined): string {
  if (isSafeInternalPath(lastRoute)) {
    const match = /^\/workspace\/([^/?#]+)/.exec(lastRoute)
    if (match) {
      return `/workspace/${match[1]}/home`
    }
  }
  return '/workspace'
}

export function chatRoute(chat: RecentChat): string {
  return `/workspace/${chat.workspaceId}/chat/${chat.id}`
}

export interface TrayDeps {
  partition: () => string
  appOrigin: () => string
  lastRoute: () => string | undefined
  /** Shortcut hint shown next to Quick Ask ('disabled' hides the hint). */
  launcherShortcut: () => string
  openMainWindow: (route?: string) => void
  toggleLauncher: () => void
  openSettings: () => void
  checkForUpdates: () => void
}

export function buildTrayMenuTemplate(
  deps: TrayDeps,
  recentChats: RecentChat[]
): MenuItemConstructorOptions[] {
  const shortcut = deps.launcherShortcut()
  const template: MenuItemConstructorOptions[] = [
    { label: 'Open Sim', click: () => deps.openMainWindow() },
    { label: 'New Chat', click: () => deps.openMainWindow(newChatRoute(deps.lastRoute())) },
    {
      label: 'Quick Ask',
      // Display-only hint: the actual binding is the globalShortcut
      // registration; tray menu accelerators on macOS render but never fire.
      ...(shortcut !== 'disabled' ? { accelerator: shortcut } : {}),
      click: () => deps.toggleLauncher(),
    },
    { type: 'separator' },
  ]
  if (recentChats.length > 0) {
    template.push({ label: 'Recent Chats', enabled: false })
    for (const chat of recentChats) {
      template.push({
        label: chat.title.length > 60 ? `${chat.title.slice(0, 57)}…` : chat.title,
        click: () => deps.openMainWindow(chatRoute(chat)),
      })
    }
    template.push({ type: 'separator' })
  }
  template.push(
    { label: 'Settings…', click: () => deps.openSettings() },
    { label: 'Check for Updates…', click: () => deps.checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit Sim', role: 'quit' }
  )
  return template
}

export interface TrayHandle {
  destroy(): void
}

/**
 * The macOS status item. No static context menu is attached — macOS shows an
 * attached menu synchronously without emitting 'click', which would freeze
 * the recent-chats section at creation time. Instead each click fetches the
 * chat list (bounded by a short timeout, falling back to the last good list)
 * and pops the freshly built menu.
 */
export function installTray(deps: TrayDeps): TrayHandle | null {
  const iconPath = join(app.getAppPath(), 'static', 'tray', 'simTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    logger.error('Tray icon missing; skipping tray install', { iconPath })
    return null
  }
  icon.setTemplateImage(true)

  const tray = new Tray(icon)
  tray.setToolTip('Sim')

  let cachedChats: RecentChat[] = []
  let refreshing = false

  const fetchRecentChats = async (): Promise<RecentChat[]> => {
    const ses = session.fromPartition(deps.partition())
    const response = await ses.fetch(`${deps.appOrigin()}${CHATS_API_PATH}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(CHATS_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`chats fetch failed: ${response.status}`)
    }
    return parseRecentChats(await response.json())
  }

  /** Update the cached chat list for the NEXT open; never blocks a click. */
  const refreshChats = async () => {
    if (refreshing) return
    refreshing = true
    try {
      cachedChats = await fetchRecentChats()
    } catch (error) {
      // Signed out, offline, or older server — the menu still works, just
      // without the recents section (or with the last good one).
      logger.info('Recent chats unavailable for tray menu', { error })
    } finally {
      refreshing = false
    }
  }

  /**
   * Pop the menu SYNCHRONOUSLY from the cached chat list so the click feels
   * instant, then refresh the cache in the background for the next open. The
   * previous approach awaited the network fetch first, adding up to the fetch
   * timeout (~1.5s) of dead time before anything appeared.
   */
  const popMenu = () => {
    if (tray.isDestroyed()) return
    tray.popUpContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(deps, cachedChats)))
    void refreshChats()
  }

  // Warm the cache so even the first click can show recents.
  void refreshChats()

  tray.on('click', popMenu)
  tray.on('right-click', popMenu)

  return {
    destroy() {
      if (!tray.isDestroyed()) {
        tray.destroy()
      }
    },
  }
}
