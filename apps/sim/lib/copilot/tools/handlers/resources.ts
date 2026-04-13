import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { type MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { getLogById } from '@/lib/logs/service'
import { getTableById } from '@/lib/table/service'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { isUuid } from '@/executor/constants'
import type { OpenResourceItem, OpenResourceParams, ValidOpenResourceParams } from './param-types'

const VALID_OPEN_RESOURCE_TYPES = new Set(Object.values(MothershipResourceType))

async function resolveResource(
  item: ValidOpenResourceParams,
  context: ExecutionContext
): Promise<MothershipResource | { error: string }> {
  const resourceType = item.type
  let resourceId = item.id
  let title: string = resourceType

  if (resourceType === 'file') {
    if (!context.workspaceId)
      return { error: 'Opening a workspace file requires workspace context.' }
    if (!isUuid(item.id))
      return { error: 'open_resource for files requires the canonical file UUID.' }
    const record = await getWorkspaceFile(context.workspaceId, item.id)
    if (!record) return { error: `No workspace file with id "${item.id}".` }
    resourceId = record.id
    title = record.name
  }
  if (resourceType === 'workflow') {
    const wf = await getWorkflowById(item.id)
    if (!wf) return { error: `No workflow with id "${item.id}".` }
    if (context.workspaceId && wf.workspaceId !== context.workspaceId)
      return { error: `Workflow not found in the current workspace.` }
    resourceId = wf.id
    title = wf.name
  }
  if (resourceType === 'table') {
    const tbl = await getTableById(item.id)
    if (!tbl) return { error: `No table with id "${item.id}".` }
    if (context.workspaceId && tbl.workspaceId !== context.workspaceId)
      return { error: `Table not found in the current workspace.` }
    resourceId = tbl.id
    title = tbl.name
  }
  if (resourceType === 'knowledgebase') {
    const kb = await getKnowledgeBaseById(item.id)
    if (!kb) return { error: `No knowledge base with id "${item.id}".` }
    if (context.workspaceId && kb.workspaceId !== context.workspaceId)
      return { error: `Knowledge base not found in the current workspace.` }
    resourceId = kb.id
    title = kb.name
  }
  if (resourceType === 'log') {
    const logRecord = await getLogById(item.id)
    if (!logRecord) return { error: `No log with id "${item.id}".` }
    if (context.workspaceId && logRecord.workspaceId !== context.workspaceId)
      return { error: `Log not found in the current workspace.` }
    resourceId = logRecord.id
    const workflowName = logRecord.workflowName ?? 'Unknown Workflow'
    const timestamp = logRecord.startedAt.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    title = `${workflowName} — ${timestamp}`
  }

  return { type: resourceType, id: resourceId, title }
}

export async function executeOpenResource(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as OpenResourceParams

  const items: OpenResourceItem[] =
    params.resources ?? (params.type && params.id ? [{ type: params.type, id: params.id }] : [])

  if (items.length === 0) {
    return { success: false, error: 'resources array is required' }
  }

  const resources: MothershipResource[] = []
  const errors: string[] = []

  for (const item of items) {
    const validated = validateOpenResourceItem(item)
    if (!validated.success) {
      errors.push(validated.error)
      continue
    }
    const result = await resolveResource(validated.params, context)
    if ('error' in result) {
      errors.push(result.error)
    } else {
      resources.push(result)
    }
  }

  return {
    success: resources.length > 0,
    output: { opened: resources.length, errors },
    resources,
  }
}

function validateOpenResourceItem(
  item: OpenResourceItem
): { success: true; params: ValidOpenResourceParams } | { success: false; error: string } {
  if (!item.type) {
    return { success: false, error: 'type is required' }
  }
  if (!VALID_OPEN_RESOURCE_TYPES.has(item.type)) {
    return { success: false, error: `Invalid resource type: ${item.type}` }
  }
  if (!item.id) {
    return { success: false, error: `${item.type} resources require \`id\`` }
  }
  return { success: true, params: { type: item.type, id: item.id } }
}
