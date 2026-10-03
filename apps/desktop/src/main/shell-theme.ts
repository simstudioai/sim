import type { BrowserWindow } from 'electron'
import { isLocalPageUrl, localPageUrl } from '@/main/local-pages'
import type { ShellTheme } from '@/shared/shell'

let theme: ShellTheme | undefined
const windows = new Set<BrowserWindow>()

export function getShellTheme(): ShellTheme | undefined {
  return theme
}

function isShellPage(url: string): boolean {
  return (
    isLocalPageUrl(url) ||
    url === localPageUrl('dialog.html') ||
    url === localPageUrl('credential-picker.html')
  )
}

/** Retains Sim's last resolved theme so recovery works even after its renderer stops. */
export function setShellTheme(next: ShellTheme | undefined): void {
  if (theme === next) return
  theme = next
  for (const win of windows) {
    if (!win.isDestroyed() && isShellPage(win.webContents.getURL())) {
      win.webContents.send('shell:theme-changed', theme)
    }
  }
}

/** Only bundled top-level pages can read the shell's appearance. */
export function attachShellTheme(win: BrowserWindow): void {
  windows.add(win)
  win.on('closed', () => windows.delete(win))
  win.webContents.ipc.handle('shell:get-theme', (event) => {
    if (
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !isShellPage(event.senderFrame.url)
    ) {
      throw new Error('Untrusted shell theme sender')
    }
    return theme
  })
}

/**
 * Picks the pre-paint window background from the persisted web-app theme so
 * dark-mode users never see a white flash before the remote page paints.
 */
export function backgroundColorFor(
  theme: 'dark' | 'light' | undefined,
  systemPrefersDark: boolean
): string {
  if (theme === 'dark') {
    return '#0c0c0c'
  }
  if (theme === 'light') {
    return '#ffffff'
  }
  return systemPrefersDark ? '#0c0c0c' : '#ffffff'
}
