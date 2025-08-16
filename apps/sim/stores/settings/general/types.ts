export interface General {
  isAutoConnectEnabled: boolean
  isAutoPanEnabled: boolean
  isConsoleExpandedByDefault: boolean
  isDebugModeEnabled: boolean
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  isLoading: boolean
  error: string | null
  // Individual loading states for optimistic updates
  isAutoConnectLoading: boolean
  isAutoPanLoading: boolean
  isConsoleExpandedByDefaultLoading: boolean
  isThemeLoading: boolean
  isTelemetryLoading: boolean
}

export interface GeneralActions {
  toggleAutoConnect: () => Promise<void>

  toggleAutoPan: () => Promise<void>
  toggleConsoleExpandedByDefault: () => Promise<void>
  toggleDebugMode: () => void
  setTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
  loadSettings: (force?: boolean) => Promise<void>
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<void>
}

export type GeneralStore = General & GeneralActions

export type UserSettings = {
  theme: 'system' | 'light' | 'dark'
  autoConnect: boolean
  autoPan: boolean
  consoleExpandedByDefault: boolean
  telemetryEnabled: boolean
}
