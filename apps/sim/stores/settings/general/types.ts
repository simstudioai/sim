export interface General {
  isAutoConnectEnabled: boolean
  isDebugModeEnabled: boolean
  isAutoFillEnvVarsEnabled: boolean
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  telemetryNotifiedUser: boolean
  isLoading: boolean
  error: string | null
}

export interface GeneralActions {
  toggleAutoConnect: () => void
  toggleDebugMode: () => void
  toggleAutoFillEnvVars: () => void
  setTheme: (theme: 'system' | 'light' | 'dark') => void
  setTelemetryEnabled: (enabled: boolean) => void
  setTelemetryNotifiedUser: (notified: boolean) => void
  loadSettings: (force?: boolean) => Promise<void>
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<void>
}

export type GeneralStore = General & GeneralActions

export type UserSettings = {
  theme: 'system' | 'light' | 'dark'
  debugMode: boolean
  autoConnect: boolean
  autoFillEnvVars: boolean
  telemetryEnabled: boolean
  telemetryNotifiedUser: boolean
}
