import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { app, BrowserWindow } from 'electron'
import { createConfigStore } from '@/main/config'
import { createDesktopSettingsService } from '@/main/desktop-settings'
import { Notification } from '@/test/electron-mock'

function makeService() {
  const config = createConfigStore(
    join(mkdtempSync(join(tmpdir(), 'sim-desktop-settings-')), 'settings.json'),
    {}
  )
  const window = new BrowserWindow()
  const openMainWindowAt = vi.fn()
  const setAutoDownloadUpdates = vi.fn()
  const service = createDesktopSettingsService({
    config,
    getMainWindow: () => window,
    openMainWindowAt,
    setAutoDownloadUpdates,
  })
  return { config, window, openMainWindowAt, setAutoDownloadUpdates, service }
}

describe('desktop settings service', () => {
  beforeEach(() => {
    Notification.instances.length = 0
    Notification.isSupported.mockReturnValue(true)
    vi.mocked(app.setLoginItemSettings).mockClear()
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: false })
  })

  it('persists preferences and applies live updater changes', () => {
    const { config, service, setAutoDownloadUpdates } = makeService()
    expect(service.getPreferences()).toMatchObject({
      notificationsEnabled: true,
      notificationsOnlyWhenUnfocused: true,
      autoDownloadUpdates: true,
    })

    service.setPreference('autoDownloadUpdates', false)
    expect(config.get('autoDownloadUpdates')).toBe(false)
    expect(setAutoDownloadUpdates).toHaveBeenCalledWith(false)
  })

  it('applies login-item changes only for packaged builds', () => {
    const { service } = makeService()
    service.setPreference('launchAtLogin', true)
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()

    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
    service.setPreference('launchAtLogin', false)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })

  it('shows notifications only when allowed and opens their route on click', () => {
    const { window, openMainWindowAt, service } = makeService()
    vi.mocked(window.isFocused).mockReturnValue(true)
    expect(service.notify({ title: 'Done', body: 'Ready' })).toBe(false)

    vi.mocked(window.isFocused).mockReturnValue(false)
    expect(
      service.notify({
        title: 'Task complete',
        body: 'Sim finished responding.',
        route: '/workspace/ws1/chat/c1',
      })
    ).toBe(true)

    const notification = Notification.instances[0]
    expect(notification.options).toMatchObject({ silent: false })
    expect(notification.show).toHaveBeenCalled()
    const click = notification.on.mock.calls.find(([event]) => event === 'click')?.[1]
    expect(click).toBeTypeOf('function')
    ;(click as () => void)()
    expect(openMainWindowAt).toHaveBeenCalledWith('/workspace/ws1/chat/c1')
  })
})
