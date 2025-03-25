export type PanelTab = 'console' | 'variables'

export interface PanelStore {
  isOpen: boolean
  activeTab: PanelTab
  togglePanel: () => void
  setActiveTab: (tab: PanelTab) => void
} 