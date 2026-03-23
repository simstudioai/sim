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
  /** Whether the panel is currently being resized */
  isResizing: boolean
  /** Updates the panel resize state */
  setIsResizing: (isResizing: boolean) => void
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}

export type ChatContext =
  | { kind: 'past_chat'; chatId: string; label: string }
  | { kind: 'workflow'; workflowId: string; label: string }
  | { kind: 'current_workflow'; workflowId: string; label: string }
  | { kind: 'blocks'; blockIds: string[]; label: string }
  | { kind: 'logs'; executionId?: string; label: string }
  | { kind: 'workflow_block'; workflowId: string; blockId: string; label: string }
  | { kind: 'knowledge'; knowledgeId?: string; label: string }
  | { kind: 'table'; tableId: string; label: string }
  | { kind: 'file'; fileId: string; label: string }
  | { kind: 'templates'; templateId?: string; label: string }
  | { kind: 'docs'; label: string }
  | { kind: 'slash_command'; command: string; label: string }
