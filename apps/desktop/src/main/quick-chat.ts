import type { QuickChatShortcut } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import type { WebContents } from 'electron'
import { BrowserWindow, globalShortcut, nativeTheme, screen } from 'electron'
import { attachContextMenu, type ContextMenuDeps } from '@/main/context-menu'
import { classifyLoadError } from '@/main/load-health'
import { backgroundColorFor } from '@/main/shell-theme'
import { handleWillPreventUnload } from '@/main/window'
import { createSecureWebPreferences } from '@/main/window-preferences'
import { attachWindowOpenPolicy, type WindowPolicyDeps } from '@/main/windows'

const logger = createLogger('QuickChat')

const WIDTH = 440
const HEIGHT = 620
const MIN_WIDTH = 360
const MIN_HEIGHT = 420

export interface QuickChatDeps {
  partition: () => string
  /** The compact chat URL to open, scoped to where the user last was. */
  startUrl: () => string
  themeBackground: () => 'dark' | 'light' | undefined
  isPackaged: boolean
  windowPolicy: WindowPolicyDeps
  contextMenu: ContextMenuDeps
}

export interface QuickChat {
  /** Shows and focuses the window, creating it on first use, or hides it when it already has focus. */
  toggle(): void
  /** Destroys the window and its page state; the next toggle starts a fresh chat. */
  close(): void
  /** Replaces the global shortcut, or removes it with null. */
  bindShortcut(shortcut: QuickChatShortcut | null): void
  /** False while another app holds the shortcut, so pressing it never reaches Sim. */
  isShortcutAvailable(): boolean
  /** The open window's page, for checks that must see every app page before a relaunch. */
  webContents(): WebContents | null
}

/**
 * A small chat window that floats above every other app until the user closes it, toggled by a
 * global shortcut. It loads the web app's compact chat surface with no preload: the page is a
 * plain client of the app origin, so it reports no device capabilities and the agent never
 * drives the browser, terminal, or apps from a window that sits on top of them. "Open in Sim"
 * hands the chat to a full window, where those capabilities live.
 */
export function createQuickChat(deps: QuickChatDeps): QuickChat {
  let win: BrowserWindow | null = null
  let loadFailed = false
  let shortcut: QuickChatShortcut | null = null

  const reveal = (target: BrowserWindow) => {
    if (loadFailed) {
      loadFailed = false
      target.webContents.reload()
    }
    target.show()
    target.focus()
  }

  const open = (): BrowserWindow => {
    loadFailed = false
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const created = new BrowserWindow({
      title: 'Sim',
      width: WIDTH,
      height: HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: Math.round(workArea.y + (workArea.height - HEIGHT) / 2),
      // A macOS panel floats over full-screen apps and on every Space, and takes keyboard focus
      // without activating Sim, so summoning it never pulls the main window forward.
      ...(process.platform === 'darwin' ? { type: 'panel' } : { skipTaskbar: true }),
      alwaysOnTop: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      backgroundColor: backgroundColorFor(deps.themeBackground(), nativeTheme.shouldUseDarkColors),
      webPreferences: createSecureWebPreferences(deps.partition(), null, deps.isPackaged),
    })
    created.once('ready-to-show', () => reveal(created))
    created.on('closed', () => {
      if (win === created) win = null
    })
    created.webContents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
      if (isMainFrame && classifyLoadError(errorCode, url) !== 'ignored') loadFailed = true
    })
    // A crashed page cannot recover in place; the next toggle builds a fresh window instead.
    created.webContents.on('render-process-gone', () => created.destroy())
    created.webContents.on('will-prevent-unload', (event) => {
      handleWillPreventUnload(created, event, deps.windowPolicy.isCommittedRelaunchPending())
    })
    attachWindowOpenPolicy(created.webContents, deps.windowPolicy)
    attachContextMenu(created.webContents, deps.contextMenu)
    void created.loadURL(deps.startUrl()).catch(() => {})
    return created
  }

  const toggle = () => {
    if (!win || win.isDestroyed()) {
      win = open()
      return
    }
    if (win.isVisible() && win.isFocused()) win.hide()
    else reveal(win)
  }

  return {
    toggle,
    close() {
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    },
    bindShortcut(next) {
      if (next === shortcut && (!next || globalShortcut.isRegistered(next))) return
      if (shortcut) globalShortcut.unregister(shortcut)
      shortcut = next
      if (next && !globalShortcut.register(next, toggle)) {
        logger.warn('Quick chat shortcut is held by another app', { shortcut: next })
      }
    },
    isShortcutAvailable: () => !shortcut || globalShortcut.isRegistered(shortcut),
    webContents: () => (win && !win.isDestroyed() ? win.webContents : null),
  }
}
