import { BrowserWindow } from 'electron'
import { createSecureWebPreferences } from '@/main/window'

const SETTINGS_PAGE = 'static/settings.html'

let settingsWindow: BrowserWindow | null = null

export interface SettingsWindowDeps {
  preloadPath: string
  isPackaged: boolean
  getMainWindow: () => BrowserWindow | null
}

/**
 * Opens (or focuses) the small local settings window for the server origin.
 * It loads a bundled file, never remote content, and shares no partition with
 * the app session.
 */
export function openSettingsWindow(deps: SettingsWindowDeps): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  const parent = deps.getMainWindow() ?? undefined
  settingsWindow = new BrowserWindow({
    title: 'Sim Settings',
    width: 460,
    height: 290,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    parent,
    webPreferences: createSecureWebPreferences('settings', deps.preloadPath, deps.isPackaged),
  })
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
  })
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  void settingsWindow.loadFile(SETTINGS_PAGE)
}

export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }
}
