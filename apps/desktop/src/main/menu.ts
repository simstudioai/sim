import type { MenuItemConstructorOptions } from 'electron'
import { app, BrowserWindow, Menu } from 'electron'
import type { ConfigStore } from '@/main/config'
import { openExternalSafe } from '@/main/navigation'

const DOCS_URL = 'https://docs.sim.ai'
const STATUS_URL = 'https://status.sim.ai'
const ZOOM_STEP = 0.5

export interface MenuDeps {
  config: ConfigStore
  getMainWindow: () => BrowserWindow | null
  allowHttpLocalhost: () => boolean
  openSettings: () => void
  newWindow: () => void
  newChat: () => void
  closeFocusedBrowserTab: (win: BrowserWindow | null) => boolean
  reopenClosedBrowserTab: (win: BrowserWindow | null) => boolean
  /**
   * Terminal counterparts. Menu accelerators are global, so Cmd-W and
   * Cmd-Shift-T reach here whatever the user is looking at; each panel gets
   * asked whether the keystroke was meant for it before the window acts.
   */
  closeFocusedTerminal: (win: BrowserWindow | null) => boolean
  reopenClosedTerminal: (win: BrowserWindow | null) => boolean
  toggleSidebar: () => void
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

  const setZoom = (resolve: (current: number) => number) =>
    withWindow((win) => {
      const level = resolve(win.webContents.getZoomLevel())
      win.webContents.setZoomLevel(level)
      deps.config.set('zoomLevel', level)
    })

  const viewSubmenu: MenuItemConstructorOptions[] = [
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
      click: withWindow((win) => win.webContents.reload()),
    },
    { type: 'separator' },
    { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: setZoom(() => 0) },
    {
      label: 'Zoom In',
      accelerator: 'CmdOrCtrl+Plus',
      click: setZoom((current) => current + ZOOM_STEP),
    },
    {
      label: 'Zoom Out',
      accelerator: 'CmdOrCtrl+-',
      click: setZoom((current) => current - ZOOM_STEP),
    },
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
            const win =
              focusedWindow instanceof BrowserWindow ? focusedWindow : deps.getMainWindow()
            if (deps.reopenClosedTerminal(win)) return
            deps.reopenClosedBrowserTab(win)
          },
        },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, focusedWindow) => {
            const win =
              focusedWindow instanceof BrowserWindow ? focusedWindow : deps.getMainWindow()
            // Both panels are asked window-scoped, so a claim made in one window
            // cannot answer an accelerator fired in another.
            if (deps.closeFocusedTerminal(win)) return
            if (deps.closeFocusedBrowserTab(win)) return
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
          label: 'System Status',
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
