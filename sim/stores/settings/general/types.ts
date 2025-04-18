export interface General {
  isAutoConnectEnabled: boolean
  isDebugModeEnabled: boolean
  isAutoFillEnvVarsEnabled: boolean
}

export interface GeneralActions {
  toggleAutoConnect: () => void
  toggleDebugMode: () => void
  toggleAutoFillEnvVars: () => void
}

export type GeneralStore = General & GeneralActions
