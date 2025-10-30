/**
 * Available panel tabs
 */
export type PanelTab = 'copilot' | 'editor'

/**
 * Panel state interface
 */
export interface PanelState {
  panelWidth: number
  setPanelWidth: (width: number) => void
  activeTab: PanelTab
  setActiveTab: (tab: PanelTab) => void
}
