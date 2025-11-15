export interface General {
  isAutoConnectEnabled: boolean
  isAutoPanEnabled: boolean
  isConsoleExpandedByDefault: boolean
  showFloatingControls: boolean
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  theme: 'system' | 'light' | 'dark'
  telemetryEnabled: boolean
  isBillingUsageNotificationsEnabled: boolean
}

export interface GeneralStore extends General {
  setSettings: (settings: Partial<General>) => void
  reset: () => void
}

export type UserSettings = {
  theme: 'system' | 'light' | 'dark'
  autoConnect: boolean
  autoPan: boolean
  consoleExpandedByDefault: boolean
  showFloatingControls: boolean
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  telemetryEnabled: boolean
  isBillingUsageNotificationsEnabled: boolean
}
