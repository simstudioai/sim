import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { app, BrowserWindow, type InputEvent, screen, session } from 'electron'
import { hasRecentDiscreteInput, trackInputActivity } from '@/main/input-activity'
import { attachLocalPageProtocol, localPageUrl } from '@/main/local-pages'
import { attachShellTheme } from '@/main/shell-theme'
import { isShellWindowSender } from '@/main/shell-window'
import { createSecureWebPreferences } from '@/main/window-preferences'
import type {
  CredentialFieldBounds,
  CredentialFillStatus,
  CredentialPickerConfiguration,
} from '@/shared/browser-credentials'

const logger = createLogger('CredentialPicker')
const WIDTH = 320
const PARTITION = 'credential-picker'

interface CredentialPickerOptions {
  parent: BrowserWindow
  anchor: CredentialFieldBounds
  configuration: CredentialPickerConfiguration
  select: (id: string) => Promise<CredentialFillStatus>
  closed: () => void
  restoreFocus: () => void
}

/** A trusted, nonmodal emcn menu above the native page; website scripts cannot cover its rows. */
export class CredentialPicker {
  private readonly window: BrowserWindow
  private anchor: CredentialFieldBounds
  private height = 420
  private wantsFocus = false
  private selecting = false

  constructor(options: CredentialPickerOptions) {
    this.anchor = options.anchor
    const ses = session.fromPartition(PARTITION)
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    attachLocalPageProtocol(ses)
    const win = new BrowserWindow({
      parent: options.parent,
      width: WIDTH,
      height: this.height,
      useContentSize: true,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      title: 'Saved passwords',
      webPreferences: createSecureWebPreferences(
        PARTITION,
        join(__dirname, 'credential-picker-preload.cjs'),
        app.isPackaged
      ),
    })
    this.window = win
    const pageUrl = localPageUrl('credential-picker.html')
    attachShellTheme(win)
    trackInputActivity(win.webContents)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.ipc.handle('credential-picker:configuration', (event) => {
      if (!isShellWindowSender(win, pageUrl, event)) throw new Error('Untrusted picker sender')
      return options.configuration
    })
    win.webContents.ipc.handle('credential-picker:select', async (event, id: unknown) => {
      if (
        !isShellWindowSender(win, pageUrl, event) ||
        !hasRecentDiscreteInput(win.webContents) ||
        this.selecting
      )
        return 'failed'
      if (
        typeof id !== 'string' ||
        !options.configuration.accounts.some((account) => account.id === id)
      )
        return 'failed'
      this.selecting = true
      try {
        return await options.select(id)
      } catch (error) {
        logger.warn('Saved password fill failed', { error: getErrorMessage(error) })
        return 'failed'
      } finally {
        this.selecting = false
      }
    })
    win.webContents.ipc.on('credential-picker:dismiss', (event) => {
      if (!isShellWindowSender(win, pageUrl, event)) return
      const restoreFocus = win.isFocused()
      this.close()
      if (restoreFocus) options.restoreFocus()
    })
    win.webContents.ipc.on('credential-picker:resize', (event, height: unknown) => {
      if (
        !isShellWindowSender(win, pageUrl, event) ||
        typeof height !== 'number' ||
        !Number.isFinite(height)
      )
        return
      clearTimeout(timeout)
      this.height = Math.min(420, Math.max(40, Math.ceil(height)))
      this.position(this.anchor)
      if (!win.isVisible()) {
        if (this.wantsFocus) win.show()
        else win.showInactive()
      }
      if (this.wantsFocus) win.focus()
    })
    const close = () => this.close()
    options.parent.on('move', close)
    options.parent.on('resize', close)
    options.parent.on('hide', close)
    options.parent.on('minimize', close)
    options.parent.on('closed', close)
    const parentInput = (_event: Electron.Event, input: InputEvent) => {
      if (['mouseDown', 'rawKeyDown', 'keyDown', 'touchStart'].includes(input.type)) this.close()
    }
    const windowFocused = (_event: Electron.Event, focused: BrowserWindow) => {
      if (focused !== options.parent && focused !== win) this.close()
    }
    options.parent.webContents.on('input-event', parentInput)
    app.on('browser-window-focus', windowFocused)
    app.on('did-resign-active', close)
    win.on('blur', close)
    const timeout = setTimeout(close, 5_000)
    win.on('closed', () => {
      clearTimeout(timeout)
      options.parent.removeListener('move', close)
      options.parent.removeListener('resize', close)
      options.parent.removeListener('hide', close)
      options.parent.removeListener('minimize', close)
      options.parent.removeListener('closed', close)
      options.parent.webContents.removeListener('input-event', parentInput)
      app.removeListener('browser-window-focus', windowFocused)
      app.removeListener('did-resign-active', close)
      options.closed()
    })
    void win.loadURL(pageUrl).catch((error) => {
      logger.warn('Could not open saved password picker', { error: getErrorMessage(error) })
      close()
    })
  }

  position(anchor: CredentialFieldBounds): void {
    if (this.window.isDestroyed()) return
    this.anchor = anchor
    const area = screen.getDisplayMatching({
      ...anchor,
      x: Math.round(anchor.x),
      y: Math.round(anchor.y),
      width: Math.ceil(anchor.width),
      height: Math.ceil(anchor.height),
    }).workArea
    const below = anchor.y + anchor.height + 4
    const y = below + this.height <= area.y + area.height ? below : anchor.y - this.height - 4
    this.window.setBounds({
      x: Math.round(Math.max(area.x, Math.min(anchor.x, area.x + area.width - WIDTH))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - this.height))),
      width: WIDTH,
      height: this.height,
    })
  }

  focus(): void {
    this.wantsFocus = true
    if (!this.window.isDestroyed() && this.window.isVisible()) this.window.focus()
  }

  close(): void {
    if (!this.window.isDestroyed()) this.window.destroy()
  }
}
