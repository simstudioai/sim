import {
  DESKTOP_THEME_DEFAULT_ATTRIBUTE,
  DESKTOP_THEME_STORAGE_KEY_ATTRIBUTE,
} from '@sim/desktop-bridge'
import { contextBridge, ipcRenderer } from 'electron'
import type { ShellTheme, ShellThemeApi } from '@/shared/shell'

/** A read-only appearance bridge, also available on the main window's offline page. */
export function exposeShellTheme(): void {
  const api: ShellThemeApi = {
    get: () => ipcRenderer.invoke('shell:get-theme'),
    onChange: (callback) => {
      const listener = (_event: unknown, theme: ShellTheme | undefined) => callback(theme)
      ipcRenderer.on('shell:theme-changed', listener)
      return () => ipcRenderer.removeListener('shell:theme-changed', listener)
    },
  }
  contextBridge.exposeInMainWorld('simShellTheme', api)
}

/**
 * The page's explicit theme choice, or the default it falls back to. The theme provider marks its
 * script with the storage key the document uses, since landing pages keep their own
 * (`sim-landing-theme`, light by default); a server too old to mark it uses the app's `sim-theme`.
 */
function themePreference(): string {
  const store = document.querySelector(`script[${DESKTOP_THEME_STORAGE_KEY_ATTRIBUTE}]`)
  const storageKey = store?.getAttribute(DESKTOP_THEME_STORAGE_KEY_ATTRIBUTE) || 'sim-theme'
  const fallback = store?.getAttribute(DESKTOP_THEME_DEFAULT_ATTRIBUTE) || 'system'
  try {
    return localStorage.getItem(storageKey) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Reports the actual app theme and the user's preference behind it, including
 * changes after hydration or OS theme changes.
 */
export function observeAppTheme(): void {
  window.addEventListener('DOMContentLoaded', () => {
    if (!['https:', 'http:'].includes(location.protocol)) return
    let previous: string | undefined
    const report = () => {
      const root = document.documentElement
      const theme: ShellTheme | undefined = root.classList.contains('dark')
        ? 'dark'
        : root.classList.contains('light')
          ? 'light'
          : undefined
      if (!theme) return
      const preference = themePreference()
      const reported = `${theme}:${preference}`
      if (reported === previous) return
      previous = reported
      ipcRenderer.send('shell:app-theme', theme, preference)
    }
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    report()
  })
}
