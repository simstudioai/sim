import type {
  DesktopNotificationPayload,
  DesktopPreferenceKey,
  DesktopPreferences,
} from '@sim/desktop-bridge'
import type { BrowserWindow } from 'electron'
import { app, Notification } from 'electron'
import type { ConfigStore } from '@/main/config'
import { isSafeInternalPath } from '@/main/config'

const PREFERENCE_KEYS: ReadonlySet<string> = new Set<DesktopPreferenceKey>([
  'notificationsEnabled',
  'notificationSounds',
  'notificationsOnlyWhenUnfocused',
  'launchAtLogin',
  'autoDownloadUpdates',
])

export function isDesktopPreferenceKey(value: unknown): value is DesktopPreferenceKey {
  return typeof value === 'string' && PREFERENCE_KEYS.has(value)
}

export interface DesktopSettingsService {
  getPreferences(): DesktopPreferences
  setPreference(key: DesktopPreferenceKey, value: boolean): DesktopPreferences
  notify(payload: DesktopNotificationPayload): boolean
  applySystemPreferences(): void
}

interface DesktopSettingsServiceDeps {
  config: ConfigStore
  getMainWindow: () => BrowserWindow | null
  openMainWindowAt: (route?: string) => void
  setAutoDownloadUpdates: (enabled: boolean) => void
}

function readPreferences(config: ConfigStore): DesktopPreferences {
  return {
    notificationsEnabled: config.get('notificationsEnabled') ?? true,
    notificationSounds: config.get('notificationSounds') ?? true,
    notificationsOnlyWhenUnfocused: config.get('notificationsOnlyWhenUnfocused') ?? true,
    launchAtLogin: config.get('launchAtLogin') ?? false,
    autoDownloadUpdates: config.get('autoDownloadUpdates') ?? true,
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
  const applyLaunchAtLogin = (enabled: boolean) => {
    // Registering an unpackaged Electron binary at login is surprising and
    // points at the wrong executable. Persist the dev preference, then apply
    // it when the packaged app starts.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled })
    }
  }

  return {
    getPreferences: () => readPreferences(deps.config),
    setPreference(key, value) {
      deps.config.set(key, value)
      if (key === 'launchAtLogin') {
        applyLaunchAtLogin(value)
      } else if (key === 'autoDownloadUpdates') {
        deps.setAutoDownloadUpdates(value)
      }
      return readPreferences(deps.config)
    },
    notify(payload) {
      const preferences = readPreferences(deps.config)
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
      const preferences = readPreferences(deps.config)
      applyLaunchAtLogin(preferences.launchAtLogin)
      deps.setAutoDownloadUpdates(preferences.autoDownloadUpdates)
    },
  }
}
