import { vi } from 'vitest'

/**
 * Shared electron module mock for unit tests. The real electron package
 * cannot be imported under Node (it resolves to a binary path), so every test
 * file that touches an electron-importing module mocks it with:
 *
 *   vi.mock('electron', () => import('@/test/electron-mock'))
 */

export const app = {
  name: 'Sim',
  isPackaged: false,
  getVersion: vi.fn(() => '1.0.0'),
  getName: vi.fn(() => 'Sim'),
  setName: vi.fn(),
  getPath: vi.fn(() => '/tmp/sim-desktop-test'),
  getAppPath: vi.fn(() => '/tmp/sim-desktop-test/app'),
  isReady: vi.fn(() => true),
  on: vi.fn(),
  once: vi.fn(),
  quit: vi.fn(),
  focus: vi.fn(),
  enableSandbox: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
  startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
  setLoginItemSettings: vi.fn(),
  dock: { downloadFinished: vi.fn() },
}

export const crashReporter = {
  start: vi.fn(),
}

export const shell = {
  openExternal: vi.fn(() => Promise.resolve()),
  showItemInFolder: vi.fn(),
}

export const dialog = {
  showMessageBox: vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })),
  showMessageBoxSync: vi.fn(() => 0),
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
}

export const safeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
}

export const clipboard = {
  writeText: vi.fn(),
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

export const nativeImage = {
  createFromPath: vi.fn(() => ({
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  })),
  createEmpty: vi.fn(() => ({
    isEmpty: vi.fn(() => true),
    setTemplateImage: vi.fn(),
  })),
  createFromBitmap: vi.fn((_buffer: unknown, options: { width: number; height: number }) => ({
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
    getSize: vi.fn(() => ({ width: options.width, height: options.height })),
  })),
}

export class Tray {
  static instances: Tray[] = []
  constructor(public image: unknown) {
    Tray.instances.push(this)
  }
  setToolTip = vi.fn()
  setContextMenu = vi.fn()
  popUpContextMenu = vi.fn()
  on = vi.fn()
  destroy = vi.fn()
  isDestroyed = vi.fn(() => false)
}

export class Notification {
  static instances: Notification[] = []
  static isSupported = vi.fn(() => true)
  constructor(public options: Record<string, unknown>) {
    Notification.instances.push(this)
  }
  on = vi.fn()
  show = vi.fn()
  close = vi.fn()
}

function createWebContentsMock() {
  return {
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(() => 'Example'),
    loadURL: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
    focus: vi.fn(),
    isFocused: vi.fn(() => false),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    setBackgroundThrottling: vi.fn(),
    capturePage: vi.fn(() =>
      Promise.resolve({
        isEmpty: vi.fn(() => false),
        toDataURL: vi.fn(() => 'data:image/png;base64,c2lt'),
      })
    ),
    executeJavaScript: vi.fn(() => Promise.resolve(undefined)),
    setWindowOpenHandler: vi.fn(),
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    debugger: {
      attach: vi.fn(),
      detach: vi.fn(),
      isAttached: vi.fn(() => false),
      sendCommand: vi.fn(() => Promise.resolve({})),
      on: vi.fn(),
    },
    session: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() },
      on: vi.fn(),
    },
  }
}

export class WebContentsView {
  webContents = createWebContentsMock()
  setBackgroundColor = vi.fn()
  setVisible = vi.fn()
  setBounds = vi.fn()
}

export class BrowserWindow {
  static fromWebContents = vi.fn(() => null)
  /** Constructor tracking for tests (the class itself is not a vi.fn mock). */
  static instances: BrowserWindow[] = []
  static lastOptions: Record<string, unknown> | undefined
  constructor(options?: Record<string, unknown>) {
    BrowserWindow.instances.push(this)
    BrowserWindow.lastOptions = options
  }
  webContents = {
    on: vi.fn(),
    getURL: vi.fn(() => ''),
    loadURL: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
    setZoomLevel: vi.fn(),
    getZoomLevel: vi.fn(() => 0),
    executeJavaScript: vi.fn(() => Promise.resolve(true)),
    focus: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    isDevToolsOpened: vi.fn(() => false),
    session: { addWordToSpellCheckerDictionary: vi.fn() },
  }
  on = vi.fn()
  once = vi.fn()
  removeListener = vi.fn()
  isDestroyed = vi.fn(() => false)
  isMinimized = vi.fn(() => false)
  isFullScreen = vi.fn(() => false)
  isMaximized = vi.fn(() => false)
  isVisible = vi.fn(() => false)
  isFocused = vi.fn(() => false)
  getNormalBounds = vi.fn(() => ({ x: 0, y: 0, width: 1360, height: 860 }))
  getBounds = vi.fn(() => ({ x: 1292, y: 41, width: 420, height: 150 }))
  setBounds = vi.fn()
  loadURL = vi.fn(() => Promise.resolve())
  loadFile = vi.fn(() => Promise.resolve())
  focus = vi.fn()
  show = vi.fn()
  showInactive = vi.fn()
  hide = vi.fn()
  close = vi.fn()
  destroy = vi.fn()
  restore = vi.fn()
  setPosition = vi.fn()
  setTitle = vi.fn()
  setVisibleOnAllWorkspaces = vi.fn()
  setAlwaysOnTop = vi.fn()
  getSize = vi.fn(() => [1180, 850])
  getContentSize = vi.fn(() => [1180, 850])
  contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  }
}
