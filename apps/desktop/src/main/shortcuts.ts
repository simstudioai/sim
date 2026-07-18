import { createLogger } from '@sim/logger'
import { app, globalShortcut } from 'electron'

const logger = createLogger('DesktopShortcuts')

export const LAUNCHER_SHORTCUT_DISABLED = 'disabled'
export const DEFAULT_LAUNCHER_SHORTCUT = 'Alt+Space'

/**
 * The rebindable presets offered in settings. A fixed allowlist (rather than a
 * free-form recorder) keeps persisted values trivially validatable and avoids
 * users binding chords Electron can't register.
 */
export const LAUNCHER_SHORTCUT_PRESETS: readonly string[] = [
  'Alt+Space',
  'Command+Shift+Space',
  'Control+Space',
  LAUNCHER_SHORTCUT_DISABLED,
]

export type LauncherShortcutStatus = 'registered' | 'failed' | 'disabled'

/**
 * Normalizes a persisted shortcut value against the preset allowlist. Unknown
 * or malformed values (hand-edited settings file) fall back to the default so
 * the launcher never silently loses its hotkey.
 */
export function normalizeLauncherShortcut(raw: string | undefined): string {
  if (typeof raw === 'string' && LAUNCHER_SHORTCUT_PRESETS.includes(raw)) {
    return raw
  }
  return DEFAULT_LAUNCHER_SHORTCUT
}

export interface LauncherShortcutManager {
  /** The currently applied (normalized) shortcut value. */
  current(): string
  /**
   * Registration outcome of the last apply. 'failed' means another app owns
   * the accelerator (the OS rejects the registration silently) — settings
   * surfaces this so the user knows to rebind.
   */
  status(): LauncherShortcutStatus
  /** (Re)registers the given shortcut, releasing the previous one. */
  apply(raw: string | undefined): LauncherShortcutStatus
  /** Releases the registration (called from will-quit). */
  dispose(): void
}

/**
 * Owns the global Quick Ask accelerator. Registration goes through Electron's
 * globalShortcut, which returns false (without throwing) when another app
 * already holds the combo — that outcome is kept as observable state instead
 * of being swallowed.
 */
export function createLauncherShortcutManager(onActivate: () => void): LauncherShortcutManager {
  let applied: string = LAUNCHER_SHORTCUT_DISABLED
  let status: LauncherShortcutStatus = 'disabled'

  const unregisterApplied = () => {
    if (applied !== LAUNCHER_SHORTCUT_DISABLED && status === 'registered') {
      try {
        globalShortcut.unregister(applied)
      } catch (error) {
        logger.warn('Failed to unregister launcher shortcut', { shortcut: applied, error })
      }
    }
  }

  const manager: LauncherShortcutManager = {
    current: () => applied,
    status: () => status,
    apply(raw) {
      const next = normalizeLauncherShortcut(raw)
      unregisterApplied()
      applied = next
      if (next === LAUNCHER_SHORTCUT_DISABLED) {
        status = 'disabled'
        return status
      }
      let registered = false
      try {
        registered = globalShortcut.register(next, onActivate)
      } catch (error) {
        logger.error('Launcher shortcut registration threw', { shortcut: next, error })
      }
      status = registered ? 'registered' : 'failed'
      if (!registered) {
        logger.warn('Launcher shortcut unavailable (held by another app?)', { shortcut: next })
      }
      return status
    },
    dispose() {
      unregisterApplied()
      applied = LAUNCHER_SHORTCUT_DISABLED
      status = 'disabled'
    },
  }

  app.on('will-quit', () => manager.dispose())

  return manager
}
