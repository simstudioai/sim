import { vi } from 'vitest'

/**
 * Shared electron module mock for unit tests. The real electron package
 * cannot be imported under Node (it resolves to a binary path), so every test
 * file that touches an electron-importing module mocks it with:
 *
 *   vi.mock('electron', () => import('@/test/electron-mock'))
 */

export const app = {
  isPackaged: false,
  getVersion: vi.fn(() => '1.0.0'),
  getName: vi.fn(() => 'Sim'),
  setName: vi.fn(),
  getPath: vi.fn(() => '/tmp/sim-desktop-test'),
  isReady: vi.fn(() => true),
  on: vi.fn(),
  once: vi.fn(),
  quit: vi.fn(),
  focus: vi.fn(),
  enableSandbox: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
  dock: { downloadFinished: vi.fn() },
}

export const shell = {
  openExternal: vi.fn(() => Promise.resolve()),
  showItemInFolder: vi.fn(),
}

export const dialog = {
  showMessageBox: vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })),
  showMessageBoxSync: vi.fn(() => 0),
}

export const clipboard = {
  writeText: vi.fn(),
}

export const systemPreferences = {
  getMediaAccessStatus: vi.fn(() => 'granted'),
  askForMediaAccess: vi.fn(() => Promise.resolve(true)),
}

export const nativeTheme = {
  shouldUseDarkColors: false,
  on: vi.fn(),
}

export const Menu = {
  buildFromTemplate: vi.fn((template: unknown[]) => ({ popup: vi.fn(), items: template })),
  setApplicationMenu: vi.fn(),
}

export const net = {
  isOnline: vi.fn(() => true),
  fetch: vi.fn(),
}

export const session = {
  fromPartition: vi.fn(),
}

export const ipcMain = {
  on: vi.fn(),
  handle: vi.fn(),
}

export class BrowserWindow {
  static fromWebContents = vi.fn(() => null)
  webContents = {
    on: vi.fn(),
    getURL: vi.fn(() => ''),
    loadURL: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
    setZoomLevel: vi.fn(),
    getZoomLevel: vi.fn(() => 0),
    executeJavaScript: vi.fn(() => Promise.resolve(true)),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: { addWordToSpellCheckerDictionary: vi.fn() },
  }
  on = vi.fn()
  once = vi.fn()
  isDestroyed = vi.fn(() => false)
  isMinimized = vi.fn(() => false)
  isFullScreen = vi.fn(() => false)
  isMaximized = vi.fn(() => false)
  getNormalBounds = vi.fn(() => ({ x: 0, y: 0, width: 1360, height: 860 }))
  loadURL = vi.fn(() => Promise.resolve())
  loadFile = vi.fn(() => Promise.resolve())
  focus = vi.fn()
  show = vi.fn()
  close = vi.fn()
  destroy = vi.fn()
  restore = vi.fn()
}
