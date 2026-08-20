export type PanelTab = 'console' | 'variables' | 'chat'

export interface PanelStore {
  isOpen: boolean
  activeTab: PanelTab
  togglePanel: () => void
  setActiveTab: (tab: PanelTab) => void
}
