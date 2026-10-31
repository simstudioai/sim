import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, screen } from 'electron'

/** Only the exact bundled top-level document may operate its own host window. */
export function isShellWindowSender(
  win: BrowserWindow,
  pageUrl: string,
  event: IpcMainEvent | IpcMainInvokeEvent
): boolean {
  return (
    !win.isDestroyed() &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame?.url === pageUrl
  )
}

/** Keeps compact native dialogs at their rendered content height, within the display. */
export function attachShellWindowSizing(
  win: BrowserWindow,
  pageUrl: string,
  width: number,
  onReady?: () => void
) {
  let ready = false
  win.webContents.ipc.on('shell:resize', (event, height: unknown) => {
    if (!isShellWindowSender(win, pageUrl, event)) return
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    const available = screen.getDisplayMatching(win.getBounds()).workArea.height - 80
    const nextHeight = Math.min(Math.max(Math.ceil(height), 120), available)
    if (win.getContentSize()[1] !== nextHeight) win.setContentSize(width, nextHeight)
    if (!ready) {
      ready = true
      onReady?.()
    }
  })
}

/**
 * Raises a window above whatever app currently has the foreground, restoring it if minimized —
 * the user just finished something in the browser or relaunched Sim and expects it in front.
 * macOS activates the app (`steal` is macOS-only). Windows ignores focus requests from a
 * background process and only flashes the taskbar button, so a momentary always-on-top lift puts
 * the window in front first.
 */
export function bringWindowToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  if (process.platform === 'win32') {
    win.setAlwaysOnTop(true)
    win.focus()
    win.setAlwaysOnTop(false)
    return
  }
  win.focus()
  app.focus({ steal: true })
}
