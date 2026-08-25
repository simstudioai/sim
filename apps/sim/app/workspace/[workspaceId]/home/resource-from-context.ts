import type { ChatContext } from '@/stores/panel'
import type { MothershipResourceType } from './types'

/** Resolves chat chips that also identify a resource-panel entity. */
export function resolveResourceFromContext(
  context: ChatContext
): { type: MothershipResourceType; id: string } | null {
  switch (context.kind) {
    case 'workflow':
    case 'current_workflow':
      return context.workflowId ? { type: 'workflow', id: context.workflowId } : null
    case 'knowledge':
      return context.knowledgeId ? { type: 'knowledgebase', id: context.knowledgeId } : null
    case 'table':
    case 'table_selection':
      return context.tableId ? { type: 'table', id: context.tableId } : null
    case 'file':
    case 'file_selection':
      return context.fileId ? { type: 'file', id: context.fileId } : null
    case 'skill':
      return context.skillId ? { type: 'skill', id: context.skillId } : null
    case 'mcp':
      return context.serverId ? { type: 'mcp_server', id: context.serverId } : null
    default:
      return null
  }
}

/** A selection chip labels the selection, while its tab labels the whole resource. */
export function resourceTitleForContext(context: ChatContext): string {
  if (context.kind === 'file_selection') return context.fileName
  if (context.kind === 'table_selection') return context.tableName
  return context.label
}
