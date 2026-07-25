import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { truncate } from '@sim/utils/string'
import type { MenuItemConstructorOptions, NativeImage } from 'electron'
import { app, Menu, nativeImage, session, Tray } from 'electron'
import {
  APP_NAME_FOR_CHANNEL,
  channelForOrigin,
  type DesktopChannel,
  isSafeInternalPath,
} from '@/main/config'

const logger = createLogger('DesktopTray')

/** Chat status dot colors, mirroring the sidebar's ConversationListItem. */
const ACTIVE_DOT_COLOR = { r: 0xea, g: 0xb3, b: 0x08 } // yellow: stream in progress
const UNREAD_DOT_COLOR = { r: 0x33, g: 0xc4, b: 0x82 } // green: finished, not yet seen

/** Chats shown inline at the top of the menu. */
const RECENT_CHATS_INLINE = 5
/** Total chats kept (inline + the "More" hover submenu). */
const RECENT_CHATS_TOTAL = 30
// Generous: the refresh is async (a click always pops the cached menu
// immediately), so a slow dev-server compile just delays the NEXT open's
// recents instead of dropping them.
const CHATS_FETCH_TIMEOUT_MS = 5000
const TRAY_ICON_SCALE_FACTOR = 2
const TRAY_SUBSCRIPT_GLYPHS = {
  L: ['1000', '1000', '1000', '1000', '1000', '1111'],
  D: ['1110', '1001', '1001', '1001', '1001', '1110'],
  S: ['1111', '1000', '1110', '0001', '0001', '1110'],
} as const

type TrayEnvironmentMarker = keyof typeof TRAY_SUBSCRIPT_GLYPHS

export function trayEnvironmentMarker(channel: DesktopChannel): TrayEnvironmentMarker | null {
  switch (channel) {
    case 'local':
      return 'L'
    case 'dev':
      return 'D'
    case 'staging':
      return 'S'
    default:
      return null
  }
}

/**
 * Adds a compact lower-right environment letter to the monochrome status
 * icon. A single crisp 2x bitmap is enough for the macOS-only desktop target;
 * template-image rendering lets the OS tint both the Sim mark and subscript.
 */
export function addTrayEnvironmentSubscript(
  source: NativeImage,
  marker: TrayEnvironmentMarker
): NativeImage {
  const sourceSize = source.getSize()
  const sourceWidth = sourceSize.width * TRAY_ICON_SCALE_FACTOR
  const sourceHeight = sourceSize.height * TRAY_ICON_SCALE_FACTOR
  const sourceBitmap = source.toBitmap({ scaleFactor: TRAY_ICON_SCALE_FACTOR })
  const glyph = TRAY_SUBSCRIPT_GLYPHS[marker]
  const glyphWidth = glyph[0].length
  const targetLogicalWidth = sourceSize.width + glyphWidth + 1
  const targetWidth = targetLogicalWidth * TRAY_ICON_SCALE_FACTOR
  const targetBitmap = Buffer.alloc(targetWidth * sourceHeight * 4)

  for (let y = 0; y < sourceHeight; y++) {
    sourceBitmap.copy(
      targetBitmap,
      y * targetWidth * 4,
      y * sourceWidth * 4,
      (y + 1) * sourceWidth * 4
    )
  }

  const glyphX = (sourceSize.width + 1) * TRAY_ICON_SCALE_FACTOR
  const glyphY = (sourceSize.height - glyph.length) * TRAY_ICON_SCALE_FACTOR
  for (let row = 0; row < glyph.length; row++) {
    for (let column = 0; column < glyphWidth; column++) {
      if (glyph[row][column] !== '1') continue
      for (let dy = 0; dy < TRAY_ICON_SCALE_FACTOR; dy++) {
        for (let dx = 0; dx < TRAY_ICON_SCALE_FACTOR; dx++) {
          const x = glyphX + column * TRAY_ICON_SCALE_FACTOR + dx
          const y = glyphY + row * TRAY_ICON_SCALE_FACTOR + dy
          const offset = (y * targetWidth + x) * 4
          targetBitmap[offset + 3] = 255
        }
      }
    }
  }

  return nativeImage.createFromBitmap(targetBitmap, {
    width: targetWidth,
    height: sourceHeight,
    scaleFactor: TRAY_ICON_SCALE_FACTOR,
  })
}
const CHATS_API_PATH = '/api/copilot/chats'

/**
 * Chat status for the menu dot, mirroring the sidebar's semantics:
 * `active` (yellow) = a stream is running; `unread` (green) = finished after
 * the user last saw the chat.
 */
export type RecentChatStatus = 'active' | 'unread' | 'none'

export interface RecentChat {
  id: string
  title: string
  workspaceId: string
  status: RecentChatStatus
}

function deriveChatStatus(chat: {
  activeStreamId?: unknown
  lastSeenAt?: unknown
  updatedAt?: unknown
}): RecentChatStatus {
  if (typeof chat.activeStreamId === 'string' && chat.activeStreamId) {
    return 'active'
  }
  const updatedAt = typeof chat.updatedAt === 'string' ? Date.parse(chat.updatedAt) : Number.NaN
  if (Number.isNaN(updatedAt)) {
    return 'none'
  }
  if (chat.lastSeenAt === null || chat.lastSeenAt === undefined) {
    return 'unread'
  }
  const lastSeenAt = typeof chat.lastSeenAt === 'string' ? Date.parse(chat.lastSeenAt) : Number.NaN
  if (Number.isNaN(lastSeenAt)) {
    return 'none'
  }
  return updatedAt > lastSeenAt ? 'unread' : 'none'
}

/**
 * Extracts tray-usable chats from the /api/copilot/chats response. Chats
 * without a workspace id are dropped — the deep link needs one — and the
 * response is already sorted by recency server-side.
 */
export function parseRecentChats(
  payload: unknown,
  limit: number = RECENT_CHATS_TOTAL
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
      status: deriveChatStatus(chat as Record<string, unknown>),
    })
  }
  return result
}

/**
 * Renders a small filled circle as a menu-item icon (menus can't color text,
 * so the sidebar's status dot becomes a NativeImage). Drawn at 2x with a 1px
 * anti-aliased edge; BGRA premultiplied, as createFromBitmap expects.
 */
function createDotImage(color: { r: number; g: number; b: number }): NativeImage {
  const scaleFactor = 2
  const size = 6 * scaleFactor
  const buffer = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radius = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = Math.max(0, Math.min(1, radius - Math.hypot(x - center, y - center)))
      const i = (y * size + x) * 4
      buffer[i] = Math.round(color.b * alpha)
      buffer[i + 1] = Math.round(color.g * alpha)
      buffer[i + 2] = Math.round(color.r * alpha)
      buffer[i + 3] = Math.round(255 * alpha)
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor })
}

let dotImages: { active: NativeImage; unread: NativeImage } | null = null

function statusDotImage(status: RecentChatStatus): NativeImage | undefined {
  if (status === 'none') {
    return undefined
  }
  if (!dotImages) {
    dotImages = {
      active: createDotImage(ACTIVE_DOT_COLOR),
      unread: createDotImage(UNREAD_DOT_COLOR),
    }
  }
  return status === 'active' ? dotImages.active : dotImages.unread
}

export function chatRoute(chat: RecentChat): string {
  return `/workspace/${chat.workspaceId}/chat/${chat.id}`
}

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
 * Route for a tray-initiated "New Chat": the home (chat) surface of the
 * workspace the user was last in, falling back to the workspace picker
 * redirect when the last route carries no workspace.
 */
export function newChatRoute(lastRoute: string | undefined): string {
  const workspaceId = workspaceIdFromRoute(lastRoute)
  return workspaceId ? `/workspace/${workspaceId}/home` : '/workspace'
}

/**
 * Route for "Settings…": the Sim app's settings surface for the workspace the
 * user was last in, falling back to the workspace picker redirect.
 */
export function settingsRoute(lastRoute: string | undefined): string {
  const workspaceId = workspaceIdFromRoute(lastRoute)
  return workspaceId ? `/workspace/${workspaceId}/settings/desktop` : '/workspace'
}

export interface TrayDeps {
  partition: () => string
  appOrigin: () => string
  lastRoute: () => string | undefined
  openMainWindow: (route?: string) => void
}

function chatMenuItem(chat: RecentChat, deps: TrayDeps): MenuItemConstructorOptions {
  const icon = statusDotImage(chat.status)
  return {
    label: truncate(chat.title, 57, '…'),
    ...(icon ? { icon } : {}),
    click: () => deps.openMainWindow(chatRoute(chat)),
  }
}

/**
 * Menu shape (modeled on ChatGPT's status item): a Recent section with the
 * newest chats inline and the rest under a "More" hover submenu, then New
 * Chat / Open Sim grouped together, then Quit in its own section.
 */
export function buildTrayMenuTemplate(
  deps: TrayDeps,
  recentChats: RecentChat[]
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  if (recentChats.length > 0) {
    template.push({ label: 'Recent Chats', enabled: false })
    for (const chat of recentChats.slice(0, RECENT_CHATS_INLINE)) {
      template.push(chatMenuItem(chat, deps))
    }
    const overflow = recentChats.slice(RECENT_CHATS_INLINE)
    if (overflow.length > 0) {
      template.push({
        label: 'More',
        submenu: overflow.map((chat) => chatMenuItem(chat, deps)),
      })
    }
    template.push({ type: 'separator' })
  }
  template.push(
    { label: 'New Chat', click: () => deps.openMainWindow(newChatRoute(deps.lastRoute())) },
    { label: 'Open Sim', click: () => deps.openMainWindow() },
    { type: 'separator' },
    // Plain item, not role:'quit' — macOS Tahoe auto-decorates standard roles
    // with SF Symbol icons and the ⌘Q badge, which this menu doesn't want.
    { label: 'Quit Sim', click: () => app.quit() }
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
  const sourceIcon = nativeImage.createFromPath(iconPath)
  if (sourceIcon.isEmpty()) {
    logger.error('Tray icon missing; skipping tray install', { iconPath })
    return null
  }
  const channel = channelForOrigin(deps.appOrigin())
  const marker = trayEnvironmentMarker(channel)
  const icon = marker ? addTrayEnvironmentSubscript(sourceIcon, marker) : sourceIcon
  icon.setTemplateImage(true)

  const tray = new Tray(icon)
  tray.setToolTip(APP_NAME_FOR_CHANNEL[channel])

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
   * Pop the menu from the cached chat list so the click feels instant, then
   * refresh the cache in the background for the next open. One exception: when
   * the cache is EMPTY (failed launch warm-up, fresh sign-in) the menu would
   * pop without a Recent section and stay wrong until the next click — so wait
   * briefly for a refresh, popping no later than the grace period either way.
   */
  const EMPTY_CACHE_POP_GRACE_MS = 600
  const popMenu = async () => {
    if (cachedChats.length === 0) {
      await Promise.race([refreshChats(), sleep(EMPTY_CACHE_POP_GRACE_MS)])
    }
    if (tray.isDestroyed()) return
    tray.popUpContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(deps, cachedChats)))
    void refreshChats()
  }

  // Warm the cache with retries: at launch the first fetch races the server
  // (dev recompiles, app cold start), and a single failed warm-up would leave
  // the first tray open without recents until a second click.
  const WARM_UP_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000]
  const warmUp = async (attempt = 0) => {
    await refreshChats()
    if (cachedChats.length === 0 && attempt < WARM_UP_BACKOFF_MS.length && !tray.isDestroyed()) {
      setTimeout(() => void warmUp(attempt + 1), WARM_UP_BACKOFF_MS[attempt]).unref?.()
    }
  }
  void warmUp()

  // Keep the cache (and the status dots) current even when the tray hasn't
  // been clicked in a while.
  const refreshTimer = setInterval(() => void refreshChats(), 60_000)
  refreshTimer.unref?.()

  tray.on('click', () => void popMenu())
  tray.on('right-click', () => void popMenu())

  return {
    destroy() {
      clearInterval(refreshTimer)
      if (!tray.isDestroyed()) {
        tray.destroy()
      }
    },
  }
}
