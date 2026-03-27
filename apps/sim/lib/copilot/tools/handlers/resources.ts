import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { MothershipResourceType } from '@/lib/copilot/resources/types'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { getTableById } from '@/lib/table/service'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { isUuid } from '@/executor/constants'
import type { OpenResourceParams, ValidOpenResourceParams } from './param-types'

const VALID_OPEN_RESOURCE_TYPES = new Set(Object.values(MothershipResourceType))

export async function executeOpenResource(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as OpenResourceParams
  const validated = validateOpenResourceParams(params)
  if (!validated.success) return { success: false, error: validated.error }

  const resourceType = validated.params.type
  let resourceId = validated.params.id
  let title: string = resourceType

  if (resourceType === 'file') {
    if (!context.workspaceId)
      return { success: false, error: 'Opening a workspace file requires workspace context.' }
    if (!isUuid(validated.params.id))
      return { success: false, error: 'open_resource for files requires the canonical file UUID.' }
    const record = await getWorkspaceFile(context.workspaceId, validated.params.id)
    if (!record)
      return { success: false, error: `No workspace file with id "${validated.params.id}".` }
    resourceId = record.id
    title = record.name
  }
  if (resourceType === 'workflow') {
    const wf = await getWorkflowById(validated.params.id)
    if (!wf) return { success: false, error: `No workflow with id "${validated.params.id}".` }
    if (context.workspaceId && wf.workspaceId !== context.workspaceId)
      return { success: false, error: `Workflow not found in the current workspace.` }
    resourceId = wf.id
    title = wf.name
  }
  if (resourceType === 'table') {
    const tbl = await getTableById(validated.params.id)
    if (!tbl) return { success: false, error: `No table with id "${validated.params.id}".` }
    if (context.workspaceId && tbl.workspaceId !== context.workspaceId)
      return { success: false, error: `Table not found in the current workspace.` }
    resourceId = tbl.id
    title = tbl.name
  }
  if (resourceType === 'knowledgebase') {
    const kb = await getKnowledgeBaseById(validated.params.id)
    if (!kb) return { success: false, error: `No knowledge base with id "${validated.params.id}".` }
    if (context.workspaceId && kb.workspaceId !== context.workspaceId)
      return { success: false, error: `Knowledge base not found in the current workspace.` }
    resourceId = kb.id
    title = kb.name
  }

  return {
    success: true,
    output: { message: `Opened ${resourceType} ${resourceId} for the user` },
    resources: [
      {
        type: resourceType,
        id: resourceId,
        title,
      },
    ],
  }
}

function validateOpenResourceParams(
  params: OpenResourceParams
): { success: true; params: ValidOpenResourceParams } | { success: false; error: string } {
  if (!params.type) {
    return { success: false, error: 'type is required' }
  }

  if (!VALID_OPEN_RESOURCE_TYPES.has(params.type)) {
    return { success: false, error: `Invalid resource type: ${params.type}` }
  }

  if (!params.id) {
    return { success: false, error: `${params.type} resources require \`id\`` }
  }

  return {
    success: true,
    params: {
      type: params.type,
      id: params.id,
    },
  }
}
