export interface General {
  isAutoConnectEnabled: boolean
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  isBillingUsageNotificationsEnabled: boolean
  isErrorNotificationsEnabled: boolean
  snapToGridSize: number
}

export interface GeneralStore extends General {
  setSettings: (settings: Partial<General>) => void
  reset: () => void
}

export type UserSettings = {
  theme: 'system' | 'light' | 'dark'
  autoConnect: boolean
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  telemetryEnabled: boolean
  isBillingUsageNotificationsEnabled: boolean
  errorNotificationsEnabled: boolean
  snapToGridSize: number
}
