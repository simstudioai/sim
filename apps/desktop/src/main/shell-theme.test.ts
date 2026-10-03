import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { BrowserWindow as ElectronWindow } from 'electron'
import { attachShellTheme, setShellTheme } from '@/main/shell-theme'
import { BrowserWindow } from '@/test/electron-mock'

beforeEach(() => {
  setShellTheme(undefined)
  vi.clearAllMocks()
})

describe('shell theme', () => {
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
