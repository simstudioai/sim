import type { MenuItemConstructorOptions } from 'electron'
import { app, BrowserWindow, Menu } from 'electron'
import type { ConfigStore } from '@/main/config'
import { DOCS_URL, STATUS_URL } from '@/main/external-links'
import { openExternalSafe } from '@/main/navigation'
import type {
  FocusedResourceShortcut,
  ResourceTabSelectionShortcut,
} from '@/main/resource-shortcuts'

const ZOOM_STEP = 0.5

export interface MenuDeps {
  config: ConfigStore
  getMainWindow: () => BrowserWindow | null
  allowHttpLocalhost: () => boolean
  openSettings: () => void
  newWindow: () => void
  newChat: () => void
  /**
   * Menu accelerators are global, so the focused Browser or Terminal gets the
   * first chance to claim every resource shortcut before the Sim window uses
   * its application-level fallback.
   */
  handleFocusedResourceShortcut: (
    win: BrowserWindow | null,
    shortcut: FocusedResourceShortcut
  ) => boolean
  toggleSidebar: () => void
  openSearch: () => void
  signOut: () => void
  checkForUpdates: () => void
}

/**
 * Builds the role-based macOS menu. Edit roles are load-bearing — without
 * them copy/paste/undo silently fail in web inputs. Zoom items are custom so
 * the zoom level persists across launches.
 */
export function buildMenuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  const withWindow = (fn: (win: BrowserWindow) => void) => () => {
    const win = deps.getMainWindow()
    if (win && !win.isDestroyed()) {
      fn(win)
    }
  }

  /** Accelerators fire on whichever window has focus; fall back to the main one. */
  const focusedOrMain = (focusedWindow: unknown): BrowserWindow | null =>
    focusedWindow instanceof BrowserWindow ? focusedWindow : deps.getMainWindow()

  const resourceShortcut = (
    shortcut: FocusedResourceShortcut
  ): NonNullable<MenuItemConstructorOptions['click']> => {
    return (_item, focusedWindow) => {
      deps.handleFocusedResourceShortcut(focusedOrMain(focusedWindow), shortcut)
    }
  }

  const numberedTabItems: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, index) => {
    const number = index + 1
    const shortcut = `select-tab-${number}` as ResourceTabSelectionShortcut
    return {
      label: number === 9 ? 'Last Tab' : `Tab ${number}`,
      accelerator: `CmdOrCtrl+${number}`,
      click: resourceShortcut(shortcut),
    }
  })

  const setZoom = (
    action: 'in' | 'out' | 'reset'
  ): NonNullable<MenuItemConstructorOptions['click']> => {
    const resolve = (current: number) =>
      action === 'reset' ? 0 : action === 'in' ? current + ZOOM_STEP : current - ZOOM_STEP
    return (_item, focusedWindow) => {
      const win = focusedOrMain(focusedWindow)
      if (!win || win.isDestroyed()) return
      if (deps.handleFocusedResourceShortcut(win, `zoom-${action}`)) return
      const level = resolve(win.webContents.getZoomLevel())
      win.webContents.setZoomLevel(level)
      deps.config.set('zoomLevel', level)
    }
  }

  const viewSubmenu: MenuItemConstructorOptions[] = [
    /**
     * The command palette is the web app's own `Mod+K` command; claiming the
     * accelerator here means the menu, not the renderer, resolves it — so the
     * click must drive the same palette the page would have opened.
     */
    {
      label: 'Search',
      accelerator: 'CmdOrCtrl+K',
      click: deps.openSearch,
    },
    {
      label: 'Toggle Sidebar',
      accelerator: 'CmdOrCtrl+B',
      click: deps.toggleSidebar,
    },
    { type: 'separator' },
    /**
     * The shell has no browser chrome, so an in-window integration connect
     * that leaves the app origin (the IdP's consent page) is otherwise a
     * one-way door for anyone who decides not to finish it.
     */
    {
      label: 'Back',
      accelerator: 'CmdOrCtrl+[',
      click: withWindow((win) => {
        const history = win.webContents.navigationHistory
        if (history.canGoBack()) {
          history.goBack()
        }
      }),
    },
    {
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      click: (_item, focusedWindow) => {
        const win = focusedOrMain(focusedWindow)
        if (!win || win.isDestroyed()) return
        if (deps.handleFocusedResourceShortcut(win, 'reload-or-clear')) return
        win.webContents.reload()
      },
    },
    { type: 'separator' },
    { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: setZoom('reset') },
    { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: setZoom('in') },
    { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: setZoom('out') },
    { type: 'separator' },
  ]
  viewSubmenu.push({ role: 'togglefullscreen' })

  return [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: deps.openSettings },
        { label: 'Check for Updates…', click: deps.checkForUpdates },
        { label: 'Sign Out', click: deps.signOut },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: (_item, focusedWindow) => {
            deps.handleFocusedResourceShortcut(focusedOrMain(focusedWindow), 'new-tab')
          },
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: deps.newWindow,
        },
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: deps.newChat },
        { type: 'separator' },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (_item, focusedWindow) => {
            deps.handleFocusedResourceShortcut(focusedOrMain(focusedWindow), 'reopen-closed-tab')
          },
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: resourceShortcut('focus-omnibox'),
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          click: resourceShortcut('next-tab'),
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: resourceShortcut('previous-tab'),
        },
        { label: 'Select Tab', submenu: numberedTabItems },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, focusedWindow) => {
            const win = focusedOrMain(focusedWindow)
            deps.handleFocusedResourceShortcut(win, 'close-tab')
          },
        },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: (_item, focusedWindow) => {
            const win = focusedOrMain(focusedWindow)
            if (win && !win.isDestroyed()) win.close()
          },
        },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Sim Documentation',
          click: () => void openExternalSafe(DOCS_URL, deps.allowHttpLocalhost()),
        },
        {
          label: 'Sim Status',
          click: () => void openExternalSafe(STATUS_URL, deps.allowHttpLocalhost()),
        },
      ],
    },
  ]
}

/**
 * Installs the application menu.
 */
export function installApplicationMenu(deps: MenuDeps): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(deps)))
}
