import { isRecordLike } from '@sim/utils/object'
import type { ChatContext } from '@/stores/panel'

/** Validates the required payload for a context restored from chat storage. */
export function isChatContext(value: unknown): value is ChatContext {
  if (!isRecordLike(value) || typeof value.kind !== 'string' || typeof value.label !== 'string') {
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
    case 'slash_command':
      return typeof value.command === 'string'
    case 'integration':
      return typeof value.blockType === 'string'
    case 'skill':
      return typeof value.skillId === 'string'
    case 'mcp':
      return typeof value.serverId === 'string'
    case 'browser_tab':
      return (
        typeof value.tabId === 'string' &&
        (value.selection === undefined ||
          (isRecordLike(value.selection) &&
            typeof value.selection.text === 'string' &&
            (value.selection.url === undefined || typeof value.selection.url === 'string') &&
            (value.selection.title === undefined || typeof value.selection.title === 'string')))
      )
    case 'terminal_tab':
      return (
        typeof value.terminalId === 'string' &&
        (value.selection === undefined ||
          (isRecordLike(value.selection) &&
            typeof value.selection.text === 'string' &&
            typeof value.selection.startLine === 'number' &&
            typeof value.selection.endLine === 'number' &&
            Number.isInteger(value.selection.startLine) &&
            Number.isInteger(value.selection.endLine) &&
            value.selection.startLine > 0 &&
            value.selection.endLine >= value.selection.startLine))
      )
    default:
      return false
  }
}
