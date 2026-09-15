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

/** Reports the actual app theme, including changes after hydration or OS theme changes. */
export function observeAppTheme(): void {
  window.addEventListener('DOMContentLoaded', () => {
    if (!['https:', 'http:'].includes(location.protocol)) return
    let previous: ShellTheme | undefined
    const report = () => {
      const root = document.documentElement
      const theme = root.classList.contains('dark')
        ? 'dark'
        : root.classList.contains('light')
          ? 'light'
          : undefined
      if (!theme || theme === previous) return
      previous = theme
      ipcRenderer.send('shell:app-theme', theme)
    }
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    report()
  })
}
