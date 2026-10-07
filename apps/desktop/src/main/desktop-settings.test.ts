import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { BrowserWindow } from 'electron'
import { createDesktopSettingsService } from '@/main/desktop-settings'
import { Notification } from '@/test/electron-mock'

function service(window: { url: string; focused: boolean } | null) {
  const config = new Map<string, unknown>()
  return createDesktopSettingsService({
    config: {
      get: (key: string) => config.get(key),
      set: (key: string, value: unknown) => config.set(key, value),
      flush: () => true,
    } as never,
    getMainWindow: () =>
      window
        ? ({
            isFocused: () => window.focused,
            webContents: { getURL: () => window.url },
          } as unknown as BrowserWindow)
        : null,
    openMainWindowAt: vi.fn(),
    setAutoDownloadUpdates: vi.fn(),
    setTrayEnabled: vi.fn(),
    setBrowserEnabled: vi.fn(),
    setTerminalEnabled: vi.fn(),
    setBrowserTheme: vi.fn(),
    setBrowserDefaultZoom: vi.fn(),
    setTerminalDefaultZoom: vi.fn(),
    getDefaultBrowserDownloadDirectory: () => '/tmp',
    chooseBrowserDownloadDirectory: async () => null,
  })
}

const BACKGROUND_CHAT = '/workspace/ws-1/chat/chat-b'

describe('desktop notifications in the default "background only" mode', () => {
  beforeEach(() => {
    Notification.instances.length = 0
  })

  it('announces a chat in the background while the user works in another one', () => {
    const shown = service({
      url: 'https://sim.ai/workspace/ws-1/chat/chat-c',
      focused: true,
    }).notify({
      title: 'Fix CI',
      body: 'Sim finished responding.',
      route: BACKGROUND_CHAT,
      background: true,
    })

    expect(shown).toBe(true)
    expect(Notification.instances).toHaveLength(1)
  })

  it('stays quiet about the chat the focused window shows', () => {
    const shown = service({ url: `https://sim.ai${BACKGROUND_CHAT}`, focused: true }).notify({
      title: 'Fix CI',
      body: 'Sim finished responding.',
      route: BACKGROUND_CHAT,
      background: true,
    })

    expect(shown).toBe(false)
    expect(Notification.instances).toHaveLength(0)
  })

  it('stays quiet about the app as a whole while it is focused', () => {
    const shown = service({ url: 'https://sim.ai/workspace/ws-1/home', focused: true }).notify({
      title: 'Update ready',
      body: 'Restart to update.',
    })

    expect(shown).toBe(false)
  })

  it('holds back an ordinary notification whenever the window is focused, wherever it is', () => {
    // The workflow panel's chat completes while the user watches it on the workflow page.
    const shown = service({ url: 'https://sim.ai/workspace/ws-1/w/wf-1', focused: true }).notify({
      title: 'Task complete',
      body: 'Sim finished responding.',
      route: BACKGROUND_CHAT,
    })

    expect(shown).toBe(false)
    expect(Notification.instances).toHaveLength(0)
  })
})
