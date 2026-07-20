import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { app, Menu } from 'electron'
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
  newChat: () => void
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
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: deps.newChat },
        { type: 'separator' },
        { role: 'close' },
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
