/**
 * Available panel tabs
 */
export type PanelTab = 'copilot' | 'editor' | 'toolbar'

/**
 * Panel state interface
 */
export interface PanelState {
  panelWidth: number
  setPanelWidth: (width: number) => void
  activeTab: PanelTab
  setActiveTab: (tab: PanelTab) => void
  /** The tab that was active before switching to the editor */
  previousTab: PanelTab | null
  setPreviousTab: (tab: PanelTab | null) => void
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}
