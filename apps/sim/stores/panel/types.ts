export type PanelTab = 'console' | 'variables' | 'chat' | 'copilot'

export interface PanelStore {
  isOpen: boolean
  activeTab: PanelTab
  panelWidth: number
  togglePanel: () => void
  setActiveTab: (tab: PanelTab) => void
  setPanelWidth: (width: number) => void
}
