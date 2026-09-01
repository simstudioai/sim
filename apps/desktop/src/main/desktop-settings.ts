import { isAbsolute } from 'node:path'
import {
  cloneTerminalSelectedProfile,
  type DesktopAppearanceTheme,
  type DesktopNotificationPayload,
  type DesktopPreferenceKey,
  type DesktopPreferences,
  type DesktopZoomPercent,
  isDesktopAppearanceTheme,
  isDesktopZoomPercent,
  isTerminalAppearanceTheme,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import type { BrowserWindow } from 'electron'
import { app, Notification } from 'electron'
import type { ConfigStore } from '@/main/config'
import { isSafeInternalPath } from '@/main/config'

export type DesktopAppearanceSettingKey = 'browserTheme' | 'terminalTheme'

const PREFERENCE_KEYS: ReadonlySet<string> = new Set<DesktopPreferenceKey>([
  'notificationsEnabled',
  'notificationSounds',
  'notificationsOnlyWhenUnfocused',
  'launchAtLogin',
  'autoDownloadUpdates',
  'trayEnabled',
  'browserEnabled',
  'terminalEnabled',
])

export function isDesktopPreferenceKey(value: unknown): value is DesktopPreferenceKey {
  return typeof value === 'string' && PREFERENCE_KEYS.has(value)
}

export interface DesktopSettingsService {
  getPreferences(): DesktopPreferences
  setPreference(key: DesktopPreferenceKey, value: boolean): DesktopPreferences
  setBrowserSearchSuggestionsEnabled(enabled: boolean): DesktopPreferences
  setAppearancePreference(
    key: DesktopAppearanceSettingKey,
    value: DesktopAppearanceTheme
  ): DesktopPreferences
  setBrowserDefaultZoom(zoom: DesktopZoomPercent): DesktopPreferences
  setTerminalDefaultZoom(zoom: DesktopZoomPercent): DesktopPreferences
  selectTerminalProfile(profile: TerminalThemeProfile): DesktopPreferences
  chooseBrowserDownloadDirectory(): Promise<DesktopPreferences | null>
  notify(payload: DesktopNotificationPayload): boolean
  applySystemPreferences(): void
}

interface DesktopSettingsServiceDeps {
  config: ConfigStore
  getMainWindow: () => BrowserWindow | null
  openMainWindowAt: (route?: string) => void
  setAutoDownloadUpdates: (enabled: boolean) => void
  /** Installs or tears down the menu-bar status item immediately. */
  setTrayEnabled: (enabled: boolean) => void
  /** Ends the running agent-browser session when the surface is turned off. */
  setBrowserEnabled: (enabled: boolean) => void
  /** Ends every open agent shell when the surface is turned off. */
  setTerminalEnabled: (enabled: boolean) => void
  /** Repaints current browser tabs when their persisted appearance changes. */
  setBrowserTheme: (theme: DesktopAppearanceTheme) => void
  /** Applies a new default zoom to current and future browser tabs. */
  setBrowserDefaultZoom: (zoom: DesktopZoomPercent) => void
  /** Applies a new default zoom to current and future terminal tabs. */
  setTerminalDefaultZoom: (zoom: DesktopZoomPercent) => void
  /** Notifies renderer chrome after a user-initiated browser appearance change. */
  onBrowserThemeChanged?: (theme: DesktopAppearanceTheme) => void
  /** Returns the OS Downloads folder used when no custom location is stored. */
  getDefaultBrowserDownloadDirectory: () => string
  /** Shows the OS folder picker, initially focused on the current location. */
  chooseBrowserDownloadDirectory: (defaultPath: string) => Promise<string | null>
}

function readPreferences(
  config: ConfigStore,
  defaultBrowserDownloadDirectory: string
): DesktopPreferences {
  const browserTheme = config.get('browserTheme')
  const browserDefaultZoom = config.get('browserDefaultZoom')
  const terminalDefaultZoom = config.get('terminalDefaultZoom')
  const storedBrowserDownloadDirectory = config.get('browserDownloadDirectory')
  const storedTerminalTheme = config.get('terminalTheme')
  return {
    notificationsEnabled: config.get('notificationsEnabled') ?? true,
    notificationSounds: config.get('notificationSounds') ?? true,
    notificationsOnlyWhenUnfocused: config.get('notificationsOnlyWhenUnfocused') ?? true,
    launchAtLogin: config.get('launchAtLogin') ?? false,
    autoDownloadUpdates: config.get('autoDownloadUpdates') ?? true,
    trayEnabled: config.get('trayEnabled') ?? true,
    browserEnabled: config.get('browserEnabled') ?? true,
    browserSearchSuggestionsEnabled: config.get('browserSearchSuggestionsEnabled') ?? true,
    terminalEnabled: config.get('terminalEnabled') ?? true,
    browserTheme: isDesktopAppearanceTheme(browserTheme) ? browserTheme : 'app',
    browserDefaultZoom: isDesktopZoomPercent(browserDefaultZoom) ? browserDefaultZoom : 100,
    browserDownloadDirectory:
      typeof storedBrowserDownloadDirectory === 'string' &&
      isAbsolute(storedBrowserDownloadDirectory)
        ? storedBrowserDownloadDirectory
        : defaultBrowserDownloadDirectory,
    terminalTheme: isTerminalAppearanceTheme(storedTerminalTheme) ? storedTerminalTheme : 'app',
    terminalDefaultZoom: isDesktopZoomPercent(terminalDefaultZoom) ? terminalDefaultZoom : 100,
  }
}

/**
 * Owns device preferences and their native side effects. Renderer code can
 * request a change, but only this main-process service touches login items,
 * updater policy, window focus, or OS notifications.
 */
export function createDesktopSettingsService(
  deps: DesktopSettingsServiceDeps
): DesktopSettingsService {
  const read = () => readPreferences(deps.config, deps.getDefaultBrowserDownloadDirectory())

  const applyLaunchAtLogin = (enabled: boolean) => {
    // Registering an unpackaged Electron binary at login is surprising and
    // points at the wrong executable. Persist the dev preference, then apply
    // it when the packaged app starts.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled })
    }
  }

  return {
    getPreferences: read,
    setPreference(key, value) {
      deps.config.set(key, value)
      // Not debounced. Every branch below takes effect immediately, and
      // `launchAtLogin` writes state the OS keeps after we exit — so a kill
      // inside the debounce window would leave the login item registered
      // while the switch that registered it reads off, and toggling it back
      // on would be a no-op the store considers unchanged.
      deps.config.flush()
      switch (key) {
        case 'launchAtLogin':
          applyLaunchAtLogin(value)
          break
        case 'autoDownloadUpdates':
          deps.setAutoDownloadUpdates(value)
          break
        case 'trayEnabled':
          deps.setTrayEnabled(value)
          break
        case 'browserEnabled':
          deps.setBrowserEnabled(value)
          break
        case 'terminalEnabled':
          deps.setTerminalEnabled(value)
          break
        default:
          break
      }
      return read()
    },
    setBrowserSearchSuggestionsEnabled(enabled) {
      deps.config.set('browserSearchSuggestionsEnabled', enabled)
      deps.config.flush()
      return read()
    },
    setAppearancePreference(key, value) {
      const previousBrowserTheme = key === 'browserTheme' ? read().browserTheme : undefined
      deps.config.set(key, value)
      deps.config.flush()
      if (key === 'browserTheme') {
        deps.setBrowserTheme(value)
        if (value !== previousBrowserTheme) {
          deps.onBrowserThemeChanged?.(value)
        }
      }
      return read()
    },
    setBrowserDefaultZoom(zoom) {
      deps.config.set('browserDefaultZoom', zoom)
      deps.config.flush()
      deps.setBrowserDefaultZoom(zoom)
      return read()
    },
    setTerminalDefaultZoom(zoom) {
      deps.config.set('terminalDefaultZoom', zoom)
      deps.config.flush()
      deps.setTerminalDefaultZoom(zoom)
      return read()
    },
    selectTerminalProfile(profile) {
      deps.config.set('terminalTheme', cloneTerminalSelectedProfile(profile))
      deps.config.flush()
      return read()
    },
    async chooseBrowserDownloadDirectory() {
      const current = read().browserDownloadDirectory
      const selected = await deps.chooseBrowserDownloadDirectory(current)
      if (!selected || !isAbsolute(selected)) return null
      deps.config.set('browserDownloadDirectory', selected)
      deps.config.flush()
      return read()
    },
    notify(payload) {
      const preferences = read()
      if (!preferences.notificationsEnabled || !Notification.isSupported()) {
        return false
      }
      const window = deps.getMainWindow()
      if (preferences.notificationsOnlyWhenUnfocused && window?.isFocused()) {
        return false
      }

      const notification = new Notification({
        title: payload.title,
        body: payload.body,
        silent: !preferences.notificationSounds,
      })
      notification.on('click', () => {
        deps.openMainWindowAt(
          payload.route && isSafeInternalPath(payload.route) ? payload.route : undefined
        )
      })
      notification.show()
      return true
    },
    applySystemPreferences() {
      const preferences = read()
      applyLaunchAtLogin(preferences.launchAtLogin)
      deps.setAutoDownloadUpdates(preferences.autoDownloadUpdates)
      deps.setBrowserTheme(preferences.browserTheme)
      deps.setBrowserDefaultZoom(preferences.browserDefaultZoom)
      deps.setTerminalDefaultZoom(preferences.terminalDefaultZoom)
    },
  }
}
