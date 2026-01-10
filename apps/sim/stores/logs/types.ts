/**
 * Log details UI state persisted across sessions.
 */
export interface LogDetailsUIState {
  panelWidth: number
  setPanelWidth: (width: number) => void
  isResizing: boolean
  setIsResizing: (isResizing: boolean) => void
}
