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

/** The app's explicit theme choice (the next-themes `sim-theme` key), or `system`. */
function themePreference(): string {
  try {
    return localStorage.getItem('sim-theme') ?? 'system'
  } catch {
    return 'system'
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
