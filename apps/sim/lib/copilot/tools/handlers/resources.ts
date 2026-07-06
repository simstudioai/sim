import { db } from '@sim/db'
import { workflowSchedule } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { type MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import { resolveToolInputFile } from '@/lib/copilot/tools/server/files/resolve-input-file'
import { chatScopedOrWorkspacePath } from '@/lib/copilot/vfs/path-utils'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { getLogById } from '@/lib/logs/service'
import { getTableById } from '@/lib/table/service'
import { getWorkflowById } from '@/lib/workflows/utils'
import type { OpenResourceItem, OpenResourceParams, ValidOpenResourceParams } from './param-types'

const VALID_OPEN_RESOURCE_TYPES = new Set(Object.values(MothershipResourceType))

async function resolveResource(
  item: ValidOpenResourceParams,
  context: ExecutionContext
): Promise<MothershipResource | { error: string }> {
  const resourceType = item.type
  let resourceId = item.id ?? ''
  let title: string = resourceType

  if (resourceType === 'file') {
    if (!context.workspaceId)
      return { error: 'Opening a workspace file requires workspace context.' }
    const fileRef = item.path || item.id || ''
    // Resolves workspace files/ paths and wf_ ids, plus this chat's uploads/
    // and outputs/ (by path or bare id) — the agent opens its own generated
    // outputs as readily as shared workspace files.
    const record = await resolveToolInputFile({
      workspaceId: context.workspaceId,
      chatId: context.chatId,
      path: fileRef,
    })
    if (!record) return { error: `No file found for "${fileRef}".` }
    // Chat uploads resolve as tool INPUTS, but no client surface can preview
    // a context='mothership' row (the by-id preview endpoint deliberately
    // whitelists workspace + output) — opening one would mint a permanently
    // broken tab. Steer to materialization instead.
    if (record.storageContext === 'mothership') {
      return {
        error: `"${fileRef}" is a chat upload and cannot be opened as a resource. Materialize it to the workspace first (materialize_file save), then open its files/ path.`,
      }
    }
    resourceId = record.id
    title = record.name
    return {
      type: resourceType,
      id: resourceId,
      title,
      path: chatScopedOrWorkspacePath(record),
    }
  }
  if (resourceType === 'workflow') {
    if (!item.id) return { error: 'workflow resources require `id`.' }
    const wf = await getWorkflowById(item.id)
    if (!wf) return { error: `No workflow with id "${item.id}".` }
    if (context.workspaceId && wf.workspaceId !== context.workspaceId)
      return { error: `Workflow not found in the current workspace.` }
    resourceId = wf.id
    title = wf.name
  }
  if (resourceType === 'table') {
    if (!item.id) return { error: 'table resources require `id`.' }
    const tbl = await getTableById(item.id)
    if (!tbl) return { error: `No table with id "${item.id}".` }
    if (context.workspaceId && tbl.workspaceId !== context.workspaceId)
      return { error: `Table not found in the current workspace.` }
    resourceId = tbl.id
    title = tbl.name
  }
  if (resourceType === 'knowledgebase') {
    if (!item.id) return { error: 'knowledgebase resources require `id`.' }
    const kb = await getKnowledgeBaseById(item.id)
    if (!kb) return { error: `No knowledge base with id "${item.id}".` }
    if (context.workspaceId && kb.workspaceId !== context.workspaceId)
      return { error: `Knowledge base not found in the current workspace.` }
    resourceId = kb.id
    title = kb.name
  }
  if (resourceType === 'log') {
    if (!item.id) return { error: 'log resources require `id`.' }
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
  if (resourceType === 'scheduledtask') {
    if (!item.id) return { error: 'scheduledtask resources require `id`.' }
    if (!context.workspaceId)
      return { error: 'Opening a scheduled task requires workspace context.' }
    const [schedule] = await db
      .select({ id: workflowSchedule.id, jobTitle: workflowSchedule.jobTitle })
      .from(workflowSchedule)
      .where(
        and(
          eq(workflowSchedule.id, item.id),
          eq(workflowSchedule.sourceWorkspaceId, context.workspaceId),
          eq(workflowSchedule.sourceType, 'job'),
          isNull(workflowSchedule.archivedAt)
        )
      )
      .limit(1)
    if (!schedule) return { error: `No scheduled task with id "${item.id}".` }
    resourceId = schedule.id
    title = schedule.jobTitle || 'Scheduled Task'
  }

  return { type: resourceType, id: resourceId, title }
}

export async function executeOpenResource(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as OpenResourceParams

  const items: OpenResourceItem[] =
    params.resources ??
    (params.type && (params.id || params.path)
      ? [{ type: params.type, id: params.id, path: params.path }]
      : [])

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
  if (!item.id && !(item.type === 'file' && item.path)) {
    return { success: false, error: `${item.type} resources require \`id\`` }
  }
  return { success: true, params: { type: item.type, id: item.id, path: item.path } }
}
