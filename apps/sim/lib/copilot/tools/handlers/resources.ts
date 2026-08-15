import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import { executeCopilotKnowledgeUseCase } from '@/lib/copilot/application/execute-knowledge-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { type MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { readKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
import { getLogById } from '@/lib/logs/service'
import type { TableSchema } from '@/lib/table'
import { getTableById } from '@/lib/table/service'
import { getTableView } from '@/lib/table/views/service'
import {
  findWorkspaceFileRecord,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { listAllWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
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
    let record: WorkspaceFileRecord | null
    if (item.path) {
      const { files } = await executeCopilotFileUseCase(context, listAllWorkspaceFiles, {
        workspaceId: context.workspaceId,
        scope: 'active',
      })
      record = findWorkspaceFileRecord(files, item.path)
    } else if (item.id) {
      record = (
        await executeCopilotFileUseCase(
          context,
          readWorkspaceFileMetadata,
          { fileId: item.id, assertedWorkspaceId: context.workspaceId },
          { fileId: item.id }
        )
      ).file
    } else {
      record = null
    }
    if (!record) return { error: `No workspace file found for "${fileRef}".` }
    resourceId = record.id
    title = record.name
    return {
      type: resourceType,
      id: resourceId,
      title,
      path: canonicalWorkspaceFilePath({ folderPath: record.folderPath, name: record.name }),
    }
  }
  if (resourceType === 'workflow') {
    if (!item.id) return { error: 'workflow resources require `id`.' }
    const wf = await getWorkflowById(item.id)
    if (!wf) return { error: `No workflow with id "${item.id}".` }
    if (context.workspaceId && wf.workspaceId !== context.workspaceId)
      return {
        error: `Workflow "${item.id}" is not in the current workspace — run glob("workflows/*/meta.json") for workflows you can reference.`,
      }
    resourceId = wf.id
    title = wf.name
  }
  if (resourceType === 'table') {
    if (!item.id) return { error: 'table resources require `id`.' }
    const tbl = await getTableById(item.id)
    if (!tbl) return { error: `No table with id "${item.id}".` }
    if (context.workspaceId && tbl.workspaceId !== context.workspaceId)
      return {
        error: `Table "${item.id}" is not in the current workspace — run glob("tables/*") for tables you can reference.`,
      }
    resourceId = tbl.id
    title = tbl.name
    if (item.view) {
      const view = await getTableView(
        item.view.trim(),
        tbl.id,
        (tbl.schema as TableSchema).columns,
        context.workspaceId ?? undefined
      )
      if (!view) {
        return {
          error: `No view with id "${item.view.trim()}" on table "${tbl.name}". View ids are listed in the table's views.json.`,
        }
      }
      title = `${tbl.name} — ${view.name}`
      return { type: resourceType, id: resourceId, title, viewId: view.id }
    }
  }
  if (resourceType === 'knowledgebase') {
    if (!item.id) return { error: 'knowledgebase resources require `id`.' }
    if (!context.workspaceId) {
      return { error: 'Opening a knowledge base requires workspace context.' }
    }
    let kb: Awaited<ReturnType<typeof readKnowledgeBase.execute>>['knowledgeBase']
    try {
      const result = await executeCopilotKnowledgeUseCase(context, readKnowledgeBase, {
        knowledgeBaseId: item.id,
        assertedWorkspaceId: context.workspaceId,
      })
      kb = result.knowledgeBase
    } catch (error) {
      const classified = asOrchestrationError(error)
      if (
        classified?.code === 'not_found' ||
        classified?.code === 'forbidden' ||
        classified?.code === 'unauthorized'
      ) {
        return {
          error: `Knowledge base "${item.id}" is not readable in the current workspace — it does not exist here or you lack access. Run glob("knowledgebases/*") for ids you can open.`,
        }
      }
      throw error
    }
    resourceId = kb.id
    title = kb.name
  }
  if (resourceType === 'log') {
    if (!item.id) return { error: 'log resources require `id`.' }
    const logRecord = await getLogById(item.id)
    if (!logRecord) return { error: `No log with id "${item.id}".` }
    if (context.workspaceId && logRecord.workspaceId !== context.workspaceId)
      return {
        error: `Log "${item.id}" is not in the current workspace — use query_logs to find valid execution ids.`,
      }
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
  return {
    success: true,
    params: { type: item.type, id: item.id, path: item.path, view: item.view },
  }
}
