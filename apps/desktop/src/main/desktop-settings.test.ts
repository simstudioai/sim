import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TERMINAL_DARK_THEME, TERMINAL_LIGHT_THEME } from '@sim/desktop-bridge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { app, BrowserWindow } from 'electron'
import { createConfigStore } from '@/main/config'
import { createDesktopSettingsService } from '@/main/desktop-settings'
import { Notification } from '@/test/electron-mock'

const IMPORTED_PALETTE = {
  ...TERMINAL_DARK_THEME,
  background: '#101010',
}
const IMPORTED_LIGHT_PALETTE = {
  ...TERMINAL_LIGHT_THEME,
  background: '#fafafa',
}
const IMPORTED_DARK_PALETTE = {
  ...TERMINAL_DARK_THEME,
  background: '#202020',
}

function makeService() {
  const config = createConfigStore(
    join(mkdtempSync(join(tmpdir(), 'sim-desktop-settings-')), 'settings.json'),
    {}
  )
  const window = new BrowserWindow()
  const openMainWindowAt = vi.fn()
  const setAutoDownloadUpdates = vi.fn()
  const setTrayEnabled = vi.fn()
  const setBrowserEnabled = vi.fn()
  const setTerminalEnabled = vi.fn()
  const setBrowserTheme = vi.fn()
  const setBrowserDefaultZoom = vi.fn()
  const setTerminalDefaultZoom = vi.fn()
  const onBrowserThemeChanged = vi.fn()
  const chooseBrowserDownloadDirectory = vi.fn(async () => '/tmp/custom-downloads')
  const service = createDesktopSettingsService({
    config,
    getMainWindow: () => window,
    openMainWindowAt,
    setAutoDownloadUpdates,
    setTrayEnabled,
    setBrowserEnabled,
    setTerminalEnabled,
    setBrowserTheme,
    setBrowserDefaultZoom,
    setTerminalDefaultZoom,
    onBrowserThemeChanged,
    getDefaultBrowserDownloadDirectory: () => '/tmp/Downloads',
    chooseBrowserDownloadDirectory,
  })
  return {
    config,
    window,
    openMainWindowAt,
    setAutoDownloadUpdates,
    setTrayEnabled,
    setBrowserEnabled,
    setTerminalEnabled,
    setBrowserTheme,
    setBrowserDefaultZoom,
    setTerminalDefaultZoom,
    onBrowserThemeChanged,
    chooseBrowserDownloadDirectory,
    service,
  }
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
      trayEnabled: true,
    })

    service.setPreference('autoDownloadUpdates', false)
    expect(config.get('autoDownloadUpdates')).toBe(false)
    expect(setAutoDownloadUpdates).toHaveBeenCalledWith(false)
  })

  it('persists tray visibility and applies it immediately', () => {
    const { config, service, setTrayEnabled } = makeService()
    service.setPreference('trayEnabled', false)
    expect(config.get('trayEnabled')).toBe(false)
    expect(setTrayEnabled).toHaveBeenCalledWith(false)
    expect(service.getPreferences().trayEnabled).toBe(false)
  })

  it('tears down the browser and terminal when their surfaces are switched off', () => {
    const { config, service, setBrowserEnabled, setTerminalEnabled } = makeService()
    expect(service.getPreferences()).toMatchObject({
      browserEnabled: true,
      terminalEnabled: true,
    })

    service.setPreference('browserEnabled', false)
    service.setPreference('terminalEnabled', false)
    expect(config.get('browserEnabled')).toBe(false)
    expect(config.get('terminalEnabled')).toBe(false)
    expect(setBrowserEnabled).toHaveBeenCalledWith(false)
    expect(setTerminalEnabled).toHaveBeenCalledWith(false)
  })

  it('defaults live browser search suggestions on and persists the privacy switch', () => {
    const { config, service } = makeService()

    expect(service.getPreferences().browserSearchSuggestionsEnabled).toBe(true)

    const preferences = service.setBrowserSearchSuggestionsEnabled(false)

    expect(config.get('browserSearchSuggestionsEnabled')).toBe(false)
    expect(preferences.browserSearchSuggestionsEnabled).toBe(false)
  })

  it('persists browser and terminal appearance with match-Sim defaults', () => {
    const { config, service, setBrowserTheme, onBrowserThemeChanged } = makeService()
    expect(service.getPreferences()).toMatchObject({
      browserTheme: 'app',
      terminalTheme: 'app',
    })

    service.setAppearancePreference('browserTheme', 'dark')
    service.setAppearancePreference('terminalTheme', 'light')

    expect(config.get('browserTheme')).toBe('dark')
    expect(config.get('terminalTheme')).toBe('light')
    expect(setBrowserTheme).toHaveBeenCalledWith('dark')
    expect(onBrowserThemeChanged).toHaveBeenCalledWith('dark')
    expect(service.getPreferences()).toMatchObject({
      browserTheme: 'dark',
      terminalTheme: 'light',
    })
  })

  it('does not announce a browser theme when the preference did not change', () => {
    const { service, onBrowserThemeChanged } = makeService()

    service.setAppearancePreference('browserTheme', 'app')

    expect(onBrowserThemeChanged).not.toHaveBeenCalled()
  })

  it('persists and applies the default browser zoom', () => {
    const { config, service, setBrowserDefaultZoom } = makeService()

    expect(service.getPreferences().browserDefaultZoom).toBe(100)

    const preferences = service.setBrowserDefaultZoom(125)

    expect(config.get('browserDefaultZoom')).toBe(125)
    expect(setBrowserDefaultZoom).toHaveBeenCalledWith(125)
    expect(preferences.browserDefaultZoom).toBe(125)
  })

  it('applies the stored browser zoom at startup', () => {
    const { config, service, setBrowserDefaultZoom } = makeService()
    config.set('browserDefaultZoom', 150)

    service.applySystemPreferences()

    expect(setBrowserDefaultZoom).toHaveBeenCalledWith(150)
  })

  it('persists and applies the default terminal zoom', () => {
    const { config, service, setTerminalDefaultZoom } = makeService()

    expect(service.getPreferences().terminalDefaultZoom).toBe(100)

    const preferences = service.setTerminalDefaultZoom(125)

    expect(config.get('terminalDefaultZoom')).toBe(125)
    expect(setTerminalDefaultZoom).toHaveBeenCalledWith(125)
    expect(preferences.terminalDefaultZoom).toBe(125)
  })

  it('applies the stored terminal zoom at startup', () => {
    const { config, service, setTerminalDefaultZoom } = makeService()
    config.set('terminalDefaultZoom', 150)

    service.applySystemPreferences()

    expect(setTerminalDefaultZoom).toHaveBeenCalledWith(150)
  })

  it('defaults browser downloads to Downloads and persists a chosen folder', async () => {
    const { chooseBrowserDownloadDirectory, config, service } = makeService()

    expect(service.getPreferences().browserDownloadDirectory).toBe('/tmp/Downloads')

    const preferences = await service.chooseBrowserDownloadDirectory()

    expect(chooseBrowserDownloadDirectory).toHaveBeenCalledWith('/tmp/Downloads')
    expect(config.get('browserDownloadDirectory')).toBe('/tmp/custom-downloads')
    expect(preferences?.browserDownloadDirectory).toBe('/tmp/custom-downloads')
  })

  it('persists a Terminal or iTerm2 profile with appearance-specific palettes', () => {
    const { config, service } = makeService()

    const preferences = service.selectTerminalProfile({
      id: 'iterm2:ocean',
      name: 'Ocean',
      source: 'iterm2',
      palette: IMPORTED_PALETTE,
      lightPalette: IMPORTED_LIGHT_PALETTE,
      darkPalette: IMPORTED_DARK_PALETTE,
    })

    expect(config.get('terminalTheme')).toEqual({
      id: 'iterm2:ocean',
      name: 'Ocean',
      source: 'iterm2',
      palette: IMPORTED_PALETTE,
      lightPalette: IMPORTED_LIGHT_PALETTE,
      darkPalette: IMPORTED_DARK_PALETTE,
    })
    expect(preferences).toMatchObject({
      terminalTheme: { id: 'iterm2:ocean', name: 'Ocean' },
    })
  })

  it('replaces a selected profile completely when a built-in theme is selected', () => {
    const { service } = makeService()

    service.selectTerminalProfile({
      id: 'iterm2:ocean',
      name: 'Ocean',
      source: 'iterm2',
      palette: IMPORTED_PALETTE,
    })
    const preferences = service.setAppearancePreference('terminalTheme', 'light')

    expect(preferences.terminalTheme).toBe('light')
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
