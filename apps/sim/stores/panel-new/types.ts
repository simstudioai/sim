/**
 * Panel state interface
 */
export interface PanelState {
  panelWidth: number
  setPanelWidth: (width: number) => void
}

/**
 * Panel width constraints
 */
export const DEFAULT_PANEL_WIDTH = 232
export const MIN_PANEL_WIDTH = 232
export const MAX_PANEL_WIDTH = 400
