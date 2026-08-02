import { isAbsolute } from 'node:path'
import {
  type DesktopAppearanceTheme,
  type DesktopNotificationPayload,
  type DesktopPreferenceKey,
  type DesktopPreferences,
  type DesktopZoomPercent,
  isDesktopAppearanceTheme,
  isDesktopZoomPercent,
  isTerminalAppearanceTheme,
  isTerminalSelectedProfile,
  type TerminalAppearanceTheme,
  type TerminalThemeProfile,
  terminalProfileThemeId,
  terminalProfileThemeValue,
} from '@sim/desktop-bridge'
import type { BrowserWindow } from 'electron'
import { app, Notification } from 'electron'
import type { ConfigStore } from '@/main/config'
import { isSafeInternalPath } from '@/main/config'

/**
 * Every key the shell accepts over the settings IPC channel: the closed
 * `setPreference` union plus preferences added after the first release, which
 * ride their own optional bridge setters but share this channel.
 */
export type DesktopSettingKey =
  | DesktopPreferenceKey
  | 'trayEnabled'
  | 'browserEnabled'
  | 'terminalEnabled'

export type DesktopAppearanceSettingKey = 'browserTheme' | 'terminalTheme'

const PREFERENCE_KEYS: ReadonlySet<string> = new Set<DesktopSettingKey>([
  'notificationsEnabled',
  'notificationSounds',
  'notificationsOnlyWhenUnfocused',
  'launchAtLogin',
  'autoDownloadUpdates',
  'trayEnabled',
  'browserEnabled',
  'terminalEnabled',
])

const APPEARANCE_KEYS: ReadonlySet<string> = new Set<DesktopAppearanceSettingKey>([
  'browserTheme',
  'terminalTheme',
])

export function isDesktopPreferenceKey(value: unknown): value is DesktopSettingKey {
  return typeof value === 'string' && PREFERENCE_KEYS.has(value)
}

export function isDesktopAppearanceSettingKey(
  value: unknown
): value is DesktopAppearanceSettingKey {
  return typeof value === 'string' && APPEARANCE_KEYS.has(value)
}

export interface DesktopSettingsService {
  getPreferences(): DesktopPreferences
  setPreference(key: DesktopSettingKey, value: boolean): DesktopPreferences
  setAppearancePreference(
    key: DesktopAppearanceSettingKey,
    value: DesktopAppearanceTheme | TerminalAppearanceTheme
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
  const storedTerminalProfile = config.get('terminalProfile')
  const terminalProfile = isTerminalSelectedProfile(storedTerminalProfile)
    ? storedTerminalProfile
    : undefined
  const selectedProfileId = isTerminalAppearanceTheme(storedTerminalTheme)
    ? terminalProfileThemeId(storedTerminalTheme)
    : null
  const terminalTheme =
    isTerminalAppearanceTheme(storedTerminalTheme) &&
    (!selectedProfileId || terminalProfile?.id === selectedProfileId)
      ? storedTerminalTheme
      : 'app'
  return {
    notificationsEnabled: config.get('notificationsEnabled') ?? true,
    notificationSounds: config.get('notificationSounds') ?? true,
    notificationsOnlyWhenUnfocused: config.get('notificationsOnlyWhenUnfocused') ?? true,
    launchAtLogin: config.get('launchAtLogin') ?? false,
    autoDownloadUpdates: config.get('autoDownloadUpdates') ?? true,
    trayEnabled: config.get('trayEnabled') ?? true,
    browserEnabled: config.get('browserEnabled') ?? true,
    terminalEnabled: config.get('terminalEnabled') ?? true,
    browserTheme: isDesktopAppearanceTheme(browserTheme) ? browserTheme : 'app',
    browserDefaultZoom: isDesktopZoomPercent(browserDefaultZoom) ? browserDefaultZoom : 100,
    browserDownloadDirectory:
      typeof storedBrowserDownloadDirectory === 'string' &&
      isAbsolute(storedBrowserDownloadDirectory)
        ? storedBrowserDownloadDirectory
        : defaultBrowserDownloadDirectory,
    terminalTheme: isTerminalAppearanceTheme(terminalTheme) ? terminalTheme : 'app',
    terminalDefaultZoom: isDesktopZoomPercent(terminalDefaultZoom) ? terminalDefaultZoom : 100,
    ...(terminalProfile ? { terminalProfile } : {}),
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
    setAppearancePreference(key, value) {
      const previousBrowserTheme = key === 'browserTheme' ? read().browserTheme : undefined
      if (key === 'browserTheme' && !isDesktopAppearanceTheme(value)) {
        return read()
      }
      if (key === 'terminalTheme') {
        if (!isTerminalAppearanceTheme(value)) return read()
        const profileId = terminalProfileThemeId(value)
        if (profileId && read().terminalProfile?.id !== profileId) {
          return read()
        }
      }
      deps.config.set(key, value)
      deps.config.flush()
      if (key === 'browserTheme') {
        const browserTheme = value as DesktopAppearanceTheme
        deps.setBrowserTheme(browserTheme)
        if (browserTheme !== previousBrowserTheme) {
          deps.onBrowserThemeChanged?.(browserTheme)
        }
      }
      return read()
    },
    setBrowserDefaultZoom(zoom) {
      if (!isDesktopZoomPercent(zoom)) return read()
      deps.config.set('browserDefaultZoom', zoom)
      deps.config.flush()
      deps.setBrowserDefaultZoom(zoom)
      return read()
    },
    setTerminalDefaultZoom(zoom) {
      if (!isDesktopZoomPercent(zoom)) return read()
      deps.config.set('terminalDefaultZoom', zoom)
      deps.config.flush()
      deps.setTerminalDefaultZoom(zoom)
      return read()
    },
    selectTerminalProfile(profile) {
      deps.config.set('terminalProfile', {
        id: profile.id,
        name: profile.name,
        source: profile.source,
        palette: { ...profile.palette },
      })
      deps.config.set('terminalTheme', terminalProfileThemeValue(profile.id))
      deps.config.flush()
      return read()
    },
    async chooseBrowserDownloadDirectory() {
      const current = read().browserDownloadDirectory ?? deps.getDefaultBrowserDownloadDirectory()
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
      deps.setBrowserTheme(preferences.browserTheme ?? 'app')
      deps.setBrowserDefaultZoom(preferences.browserDefaultZoom ?? 100)
      deps.setTerminalDefaultZoom(preferences.terminalDefaultZoom ?? 100)
    },
  }
}
