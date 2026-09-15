import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))
vi.unmock('@/main/dialogs')

import { dialog, session } from 'electron'
import { showShellDialog } from '@/main/dialogs'
import { BrowserWindow } from '@/test/electron-mock'

function latestWindow() {
  const win = BrowserWindow.instances.at(-1)
  if (!win) throw new Error('Dialog window was not created')
  win.webContents.mainFrame.url = 'sim-shell://pages/dialog.html'
  return win
}

function sender(win: BrowserWindow) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

function respond(win: BrowserWindow, response: unknown, event = sender(win)) {
  const handler = win.webContents.ipc.on.mock.calls.find(
    ([channel]) => channel === 'shell:respond'
  )?.[1]
  if (!handler) throw new Error('Missing dialog response handler')
  handler(event, response)
}

beforeEach(() => {
  vi.clearAllMocks()
  BrowserWindow.instances.length = 0
  vi.mocked(session.fromPartition).mockReturnValue({
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    protocol: { isProtocolHandled: () => false, handle: vi.fn() },
  } as never)
})

describe('showShellDialog', () => {
  it('uses an isolated preload and preserves response indices', async () => {
    const result = showShellDialog({
      message: 'Continue?',
      buttons: ['Later', 'Continue'],
      cancelId: 0,
    })
    const win = latestWindow()
    expect(BrowserWindow.lastOptions).toMatchObject({
      frame: false,
      webPreferences: {
        partition: 'shell-dialogs',
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    respond(win, 1)
    await expect(result).resolves.toEqual({ response: 1, checkboxChecked: false })
    expect(win.destroy).toHaveBeenCalledOnce()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('rejects foreign documents, subframes, and invalid action indices', async () => {
    const result = showShellDialog({ message: 'Allow?', buttons: ['Block', 'Allow'], cancelId: 0 })
    const win = latestWindow()
    respond(win, 1, { ...sender(win), senderFrame: { url: 'sim-shell://pages/dialog.html' } })
    win.webContents.mainFrame.url = 'https://untrusted.example'
    respond(win, 1)
    win.webContents.mainFrame.url = 'sim-shell://pages/dialog.html'
    respond(win, -1)
    respond(win, 2)
    respond(win, '1')
    expect(win.destroy).not.toHaveBeenCalled()
    respond(win, 0)
    await expect(result).resolves.toMatchObject({ response: 0 })
  })

  it('settles once and refuses a late response after cancellation', async () => {
    const controller = new AbortController()
    const result = showShellDialog({
      message: 'Allow?',
      buttons: ['Block', 'Allow'],
      cancelId: 0,
      signal: controller.signal,
    })
    const win = latestWindow()
    controller.abort()
    respond(win, 1)
    await expect(result).resolves.toMatchObject({ response: 0 })
    expect(win.destroy).toHaveBeenCalledOnce()
  })

  it('does not open an already-aborted prompt', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      showShellDialog({ message: 'Continue?', signal: controller.signal })
    ).resolves.toMatchObject({ response: 0 })
    expect(BrowserWindow.instances).toHaveLength(0)
  })

  it('uses the OS recovery fallback only when the bundled renderer fails', async () => {
    const result = showShellDialog({
      message: 'Recover',
      buttons: ['Restart', 'Quit'],
      cancelId: 1,
    })
    const win = latestWindow()
    const failed = win.webContents.on.mock.calls.find(([event]) => event === 'did-fail-load')?.[1]
    failed?.({}, -6, 'missing asset', 'sim-shell://pages/dialog.html', true)
    await expect(result).resolves.toMatchObject({ response: 0 })
    expect(dialog.showMessageBox).toHaveBeenCalledOnce()
  })

  it('clamps content sizing and ignores untrusted resize messages', async () => {
    const result = showShellDialog({ message: 'Info' })
    const win = latestWindow()
    const resize = win.webContents.ipc.on.mock.calls.find(
      ([channel]) => channel === 'shell:resize'
    )?.[1]
    resize?.({ ...sender(win), senderFrame: { url: 'https://untrusted.example' } }, 500)
    resize?.(sender(win), Number.NaN)
    expect(win.setContentSize).not.toHaveBeenCalled()
    resize?.(sender(win), 100000)
    expect(win.setContentSize).toHaveBeenCalledWith(500, 820)
    respond(win, 0)
    await result
  })
})
