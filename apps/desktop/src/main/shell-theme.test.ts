import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { BrowserWindow as ElectronWindow } from 'electron'
import { attachShellTheme, getShellTheme, setShellTheme } from '@/main/shell-theme'
import { BrowserWindow } from '@/test/electron-mock'

beforeEach(() => {
  setShellTheme(undefined)
  vi.clearAllMocks()
})

describe('shell theme', () => {
  it('retains the resolved app theme and updates only bundled pages', () => {
    const local = new BrowserWindow({})
    const app = new BrowserWindow({})
    local.webContents.getURL.mockReturnValue('sim-shell://pages/dialog.html')
    app.webContents.getURL.mockReturnValue('https://sim.example')
    attachShellTheme(local as unknown as ElectronWindow)
    attachShellTheme(app as unknown as ElectronWindow)
    setShellTheme('dark')
    expect(getShellTheme()).toBe('dark')
    expect(local.webContents.send).toHaveBeenCalledWith('shell:theme-changed', 'dark')
    expect(app.webContents.send).not.toHaveBeenCalled()
    setShellTheme('dark')
    expect(local.webContents.send).toHaveBeenCalledOnce()
    local.on.mock.calls.find(([event]) => event === 'closed')?.[1]()
    app.on.mock.calls.find(([event]) => event === 'closed')?.[1]()
    setShellTheme('light')
    expect(local.webContents.send).toHaveBeenCalledOnce()
  })

  it('rejects theme reads from foreign documents and subframes', () => {
    const win = new BrowserWindow({})
    attachShellTheme(win as unknown as ElectronWindow)
    const read = win.webContents.ipc.handle.mock.calls.find(
      ([channel]) => channel === 'shell:get-theme'
    )?.[1]
    if (!read) throw new Error('Missing theme handler')
    const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
    win.webContents.mainFrame.url = 'sim-shell://pages/offline.html?kind=dns'
    setShellTheme('light')
    expect(read(event)).toBe('light')
    expect(() => read({ ...event, senderFrame: { url: event.senderFrame.url } })).toThrow(
      'Untrusted'
    )
    win.webContents.mainFrame.url = 'https://untrusted.example'
    expect(() => read(event)).toThrow('Untrusted')
    win.on.mock.calls.find(([event]) => event === 'closed')?.[1]()
  })
})
