import { isRecordLike } from '@sim/utils/object'
import { chatContextSchema } from '@/lib/api/contracts/mothership-chat-context'
import type { ChatContext } from '@/stores/panel'

export const UNAVAILABLE_CONTEXT_NOTICE =
  'Some context in this message was not saved. Reattach it before sending.'

/** Requires both send-valid metadata and a resource identity before restoring a stored context. */
export function isChatContext(value: unknown): value is ChatContext {
  if (!isRecordLike(value) || !chatContextSchema.safeParse(value).success) {
    return false
  }

  switch (value.kind) {
    case 'past_chat':
      return typeof value.chatId === 'string'
    case 'workflow':
    case 'current_workflow':
      return typeof value.workflowId === 'string'
    case 'blocks':
      return Array.isArray(value.blockIds) && value.blockIds.every((id) => typeof id === 'string')
    case 'logs':
      return value.executionId === undefined || typeof value.executionId === 'string'
    case 'workflow_block':
      return typeof value.workflowId === 'string' && typeof value.blockId === 'string'
    case 'knowledge':
      return value.knowledgeId === undefined || typeof value.knowledgeId === 'string'
    case 'table':
      return typeof value.tableId === 'string'
    case 'table_selection':
      return (
        typeof value.tableId === 'string' &&
        typeof value.tableName === 'string' &&
        Array.isArray(value.rowIds) &&
        value.rowIds.every((id) => typeof id === 'string')
      )
    case 'file':
      return typeof value.fileId === 'string'
    case 'file_selection':
      return (
        typeof value.fileId === 'string' &&
        typeof value.fileName === 'string' &&
        typeof value.text === 'string'
      )
    case 'dashboard':
      return typeof value.dashboardId === 'string'
    case 'project':
      return typeof value.projectId === 'string'
    case 'folder':
      return typeof value.folderId === 'string'
    case 'filefolder':
      return typeof value.fileFolderId === 'string'
    case 'workspace':
      return typeof value.workspaceId === 'string'
    case 'docs':
      return true
    case 'integration':
      return typeof value.blockType === 'string'
    case 'skill':
      return typeof value.skillId === 'string'
    case 'mcp':
      return typeof value.serverId === 'string'
    case 'browser_tab':
      return typeof value.tabId === 'string'
    case 'terminal_tab':
      return typeof value.terminalId === 'string'
    default:
      return false
  }
}
