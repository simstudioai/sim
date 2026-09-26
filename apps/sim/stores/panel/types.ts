import type { MothershipTableViewContext } from '@/lib/api/contracts/mothership-resources'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'

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

export interface BrowserTextSelection {
  text: string
  url?: string
  title?: string
}

export interface TerminalTextSelection {
  text: string
  startLine: number
  endLine: number
}

/**
 * Names the workspace that owns a referenced resource. An organization chat has
 * no workspace of its own, so its contexts carry their owner, which the server
 * authorizes before reading anything; a workspace chat's contexts omit it.
 */
interface WorkspaceOwned {
  workspaceId?: string
}

export type ChatContext =
  | ({ kind: 'past_chat'; chatId: string; label: string } & WorkspaceOwned)
  | ({ kind: 'workflow'; workflowId: string; label: string } & WorkspaceOwned)
  | { kind: 'current_workflow'; workflowId: string; label: string }
  | { kind: 'blocks'; blockIds: string[]; label: string }
  | ({ kind: 'logs'; executionId?: string; label: string } & WorkspaceOwned)
  | ({
      kind: 'workflow_block'
      workflowId: string
      blockId: string
      label: string
    } & WorkspaceOwned)
  | ({ kind: 'knowledge'; knowledgeId?: string; label: string } & WorkspaceOwned)
  | ({
      kind: 'table'
      tableId: string
      viewId?: string
      currentView?: MothershipTableViewContext
      label: string
    } & WorkspaceOwned)
  | ({
      kind: 'table_selection'
      tableId: string
      label: string
      /**
       * Name of the table the selection came from. Carried explicitly rather
       * than parsed back out of `label`, which is a display string the input may
       * rewrite to keep chip tokens unique.
       */
      tableName: string
      /** Materialized from the grid selection, including rows not yet paged in. */
      rowIds: string[]
      /**
       * Ids of the selected columns. Present only for a spreadsheet-style cell
       * range; absent when whole rows are selected.
       */
      columnIds?: string[]
    } & WorkspaceOwned)
  | ({ kind: 'file'; fileId: string; label: string } & WorkspaceOwned)
  | ({
      kind: 'file_selection'
      fileId: string
      label: string
      /** Name of the file the selection came from. See `tableName` above. */
      fileName: string
      /**
       * The literal selected text. Carried inline rather than re-read
       * server-side because the editor may hold unsaved changes — re-reading
       * would hand the agent different bytes than the user highlighted.
       */
      text: string
      /**
       * 1-based inclusive line range, present only when the source has real
       * line numbers (Monaco). The rich-markdown editor's document model has no
       * source lines, so it omits these rather than approximating them.
       */
      startLine?: number
      endLine?: number
    } & WorkspaceOwned)
  | ({ kind: 'folder'; folderId: string; label: string } & WorkspaceOwned)
  | ({ kind: 'filefolder'; fileFolderId: string; label: string } & WorkspaceOwned)
  /** A whole workspace in an organization chat: "I'm working in this one". */
  | { kind: 'workspace'; workspaceId: string; label: string }
  | { kind: 'docs'; label: string }
  /**
   * A tab in the desktop browser or terminal panel, dragged into the input to
   * say "this one". Resource tags remain live pointers; tags created from an
   * explicit text selection additionally carry that immutable excerpt and its
   * page/line metadata so the exact selection survives send and chat reload.
   */
  | { kind: 'browser_tab'; tabId: string; label: string; selection?: BrowserTextSelection }
  | { kind: 'terminal_tab'; terminalId: string; label: string; selection?: TerminalTextSelection }
  | { kind: 'slash_command'; command: string; label: string }
  | { kind: 'integration'; blockType: string; label: string }
  | ({ kind: 'skill'; skillId: string; label: string } & WorkspaceOwned)
  | {
      kind: 'mcp'
      serverId: string
      label: string
      managedConnectorId?: ManagedMcpConnectorId
    }
