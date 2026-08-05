import type { ChatContext } from '@/stores/panel'
import type { BrowserTextSelection, TerminalTextSelection } from '@/stores/panel/types'

/**
 * The types a chat *turn* is made of, shared by every surface that draws one —
 * the Sim chat in the workspace, and any future surface that draws one.
 *
 * Deliberately free of workspace concepts. A message, its attachments, and the
 * mentions inside it look the same wherever the turn came from; who may act on
 * them is the mounting surface's business, not the renderer's.
 */

/** Union of all valid context kind strings, derived from {@link ChatContext}. */
export type ChatContextKind = ChatContext['kind']

/** One `@mention` / `/command` resolved inside a user turn. */
export interface ChatMessageContext {
  kind: ChatContextKind
  label: string
  workflowId?: string
  knowledgeId?: string
  tableId?: string
  fileId?: string
  folderId?: string
  chatId?: string
  blockType?: string
  skillId?: string
  serverId?: string
  /** Selected passage for a `file_selection` context. */
  text?: string
  /** Source file name for a `file_selection` context. */
  fileName?: string
  /** 1-based inclusive line range for a `file_selection` context. */
  startLine?: number
  endLine?: number
  /** Source table name for a `table_selection` context. */
  tableName?: string
  /** Selected row ids for a `table_selection` context. */
  rowIds?: string[]
  /** Selected column ids for a `table_selection` cell range. */
  columnIds?: string[]
  tabId?: string
  terminalId?: string
  selection?: BrowserTextSelection | TerminalTextSelection
}

/** One file carried by a user turn, as the transcript stores it. */
export interface ChatMessageAttachment {
  id: string
  filename: string
  media_type: string
  size: number
  previewUrl?: string
}
