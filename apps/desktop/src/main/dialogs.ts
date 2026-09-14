import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { app, BrowserWindow, dialog, nativeTheme, session } from 'electron'
import { attachLocalPageProtocol, localPageUrl } from '@/main/local-pages'
import { attachShellWindowSizing, isShellWindowSender } from '@/main/shell-window'
import { createSecureWebPreferences } from '@/main/window-preferences'
import type { ShellDialogConfiguration } from '@/shared/shell'

const logger = createLogger('DesktopDialogs')
const DIALOG_WIDTH = 500
const DIALOG_PARTITION = 'shell-dialogs'

interface ShellDialogOptions extends MessageBoxOptions {
  primaryVariant?: ShellDialogConfiguration['primaryVariant']
}

export function showShellDialog(options: ShellDialogOptions): Promise<MessageBoxReturnValue>
export function showShellDialog(
  parent: BrowserWindow,
  options: ShellDialogOptions
): Promise<MessageBoxReturnValue>
/**
 * Presents app-owned messages in an isolated bundled EMCN window. The OS dialog
 * is the last-resort fallback if this recovery renderer itself cannot load.
 */
export function showShellDialog(
  parentOrOptions: BrowserWindow | ShellDialogOptions,
  suppliedOptions?: ShellDialogOptions
): Promise<MessageBoxReturnValue> {
  const parent = suppliedOptions ? (parentOrOptions as BrowserWindow) : undefined
  const options = suppliedOptions ?? (parentOrOptions as ShellDialogOptions)
  const buttons = options.buttons?.length ? options.buttons : ['OK']
  const cancelId =
    options.cancelId ??
    Math.max(
      0,
      buttons.findIndex((label) => /^(cancel|no|close|ok)$/i.test(label))
    )
  const configuration: ShellDialogConfiguration = {
    title: options.title ?? 'Sim',
    message: options.message,
    detail: options.detail ?? '',
    type: options.type ?? 'none',
    buttons,
    defaultId: options.defaultId ?? 0,
    cancelId,
    primaryVariant: options.primaryVariant ?? 'primary',
  }
  const cancelled = { response: cancelId, checkboxChecked: false }
  if (options.signal?.aborted) return Promise.resolve(cancelled)

  return new Promise((resolve, reject) => {
    const ses = session.fromPartition(DIALOG_PARTITION)
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    attachLocalPageProtocol(ses)
    const win = new BrowserWindow({
      width: DIALOG_WIDTH,
      height: 240,
      useContentSize: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: configuration.title,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1b' : '#ffffff',
      ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
      webPreferences: createSecureWebPreferences(
        DIALOG_PARTITION,
        join(__dirname, 'shell-preload.cjs'),
        app.isPackaged
      ),
    })
    const pageUrl = localPageUrl('dialog.html')
    let settled = false
    const finish = (response: number) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      clearTimeout(loadTimeout)
      if (!win.isDestroyed()) win.destroy()
      resolve({ response, checkboxChecked: false })
    }
    const abort = () => finish(cancelId)
    const fallback = () => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      clearTimeout(loadTimeout)
      if (!win.isDestroyed()) win.destroy()
      const result =
        parent && !parent.isDestroyed()
          ? dialog.showMessageBox(parent, options)
          : dialog.showMessageBox(options)
      void result.then(resolve, reject)
    }
    const loadTimeout = setTimeout(fallback, 10_000)
    options.signal?.addEventListener('abort', abort, { once: true })
    win.on('closed', abort)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.on('will-redirect', (event) => event.preventDefault())
    win.webContents.on('render-process-gone', fallback)
    win.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) fallback()
    })
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        abort()
      }
    })
    win.webContents.ipc.handle('shell:configuration', (event) => {
      if (!isShellWindowSender(win, pageUrl, event)) throw new Error('Untrusted dialog sender')
      return configuration
    })
    win.webContents.ipc.on('shell:respond', (event, response: unknown) => {
      if (!isShellWindowSender(win, pageUrl, event)) return
      if (typeof response !== 'number' || !Number.isInteger(response) || !buttons[response]) return
      finish(response)
    })
    attachShellWindowSizing(win, pageUrl, DIALOG_WIDTH, () => {
      if (settled) return
      clearTimeout(loadTimeout)
      win.show()
    })
    void win.loadURL(pageUrl).catch((error) => {
      logger.error('Could not load a bundled dialog', { error: getErrorMessage(error) })
      fallback()
    })
  })
}
