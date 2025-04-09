export interface General {
  isAutoConnectEnabled: boolean
  isDebugModeEnabled: boolean
  isAutoFillEnvVarsEnabled: boolean
  theme: 'system' | 'light' | 'dark'
}

export interface GeneralActions {
  toggleAutoConnect: () => void
  toggleDebugMode: () => void
  toggleAutoFillEnvVars: () => void
  setTheme: (theme: 'system' | 'light' | 'dark') => void
}

export type GeneralStore = General & GeneralActions
