import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))
vi.unmock('@/main/dialogs')

import { session } from 'electron'
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
  BrowserWindow.instances.length = 0
  vi.mocked(session.fromPartition).mockReturnValue({
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    protocol: { isProtocolHandled: () => false, handle: vi.fn() },
  } as never)
})

describe('showShellDialog', () => {
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
})
