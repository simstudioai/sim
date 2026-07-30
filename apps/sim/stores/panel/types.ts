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
  | {
      kind: 'table_selection'
      tableId: string
      label: string
      /** Ids of the selected rows. Always present (materialized from the grid selection). */
      rowIds: string[]
      /**
       * Ids of the selected columns. Present only for a spreadsheet-style cell
       * range; absent when whole rows are selected.
       */
      columnIds?: string[]
    }
  | { kind: 'file'; fileId: string; label: string }
  | {
      kind: 'file_selection'
      fileId: string
      label: string
      /** The literal selected text, carried inline so the agent sees the exact passage. */
      text: string
      /** 1-based inclusive line range of the selection, when the source has lines. */
      startLine?: number
      endLine?: number
    }
  | { kind: 'folder'; folderId: string; label: string }
  | { kind: 'filefolder'; fileFolderId: string; label: string }
  | { kind: 'scheduledtask'; scheduleId: string; label: string }
  | { kind: 'docs'; label: string }
  /**
   * A tab in the desktop browser or terminal panel, dragged into the input to
   * say "this one". A pointer rather than a snapshot: the agent reads the tab
   * with its own tools, so what it sees is the live state at the moment it
   * looks rather than whatever was on screen when the message was sent.
   */
  | { kind: 'browser_tab'; tabId: string; label: string }
  | { kind: 'terminal_tab'; terminalId: string; label: string }
  | { kind: 'slash_command'; command: string; label: string }
  | { kind: 'integration'; blockType: string; label: string }
  | { kind: 'skill'; skillId: string; label: string }
  | { kind: 'mcp'; serverId: string; label: string }
