import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { getContextPack, saveContextPack } from './change-store'
import {
  buildSchemasByType,
  getAllKnownBlockTypes,
  hashWorkflowState,
  loadWorkflowStateFromDb,
  summarizeWorkflowState,
} from './workflow-state'

const logger = createLogger('WorkflowContextServerTool')

const WorkflowContextGetInputSchema = z.object({
  workflowId: z.string(),
  objective: z.string().optional(),
  includeBlockTypes: z.array(z.string()).optional(),
  includeAllSchemas: z.boolean().optional(),
})

type WorkflowContextGetParams = z.infer<typeof WorkflowContextGetInputSchema>

const WorkflowContextExpandInputSchema = z.object({
  contextPackId: z.string(),
  blockTypes: z.array(z.string()).optional(),
  schemaRefs: z.array(z.string()).optional(),
})

type WorkflowContextExpandParams = z.infer<typeof WorkflowContextExpandInputSchema>

function parseSchemaRefToBlockType(schemaRef: string): string | null {
  if (!schemaRef) return null
  const [blockType] = schemaRef.split('@')
  return blockType || null
}

function buildAvailableBlockCatalog(
  schemaRefsByType: Record<string, string>
): Array<Record<string, any>> {
  return Object.entries(schemaRefsByType)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([blockType, schemaRef]) => ({
      blockType,
      schemaRef,
    }))
}

export const workflowContextGetServerTool: BaseServerTool<WorkflowContextGetParams, any> = {
  name: 'workflow_context_get',
  inputSchema: WorkflowContextGetInputSchema,
  async execute(params: WorkflowContextGetParams, context?: { userId: string }): Promise<any> {
    if (!context?.userId) {
      throw new Error('Unauthorized workflow access')
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: params.workflowId,
      userId: context.userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      throw new Error(authorization.message || 'Unauthorized workflow access')
    }

    const { workflowState } = await loadWorkflowStateFromDb(params.workflowId)
    const snapshotHash = hashWorkflowState(workflowState as unknown as Record<string, unknown>)

    const blockTypesInWorkflow = Object.values(workflowState.blocks || {}).map((block: any) =>
      String(block?.type || '')
    )
    const requestedTypes = params.includeBlockTypes || []
    const includeAllSchemas = params.includeAllSchemas === true
    const candidateTypes = includeAllSchemas
      ? getAllKnownBlockTypes()
      : [...blockTypesInWorkflow, ...requestedTypes]
    const { schemasByType, schemaRefsByType } = buildSchemasByType(candidateTypes)

    const summary = summarizeWorkflowState(workflowState)
    const packId = saveContextPack({
      workflowId: params.workflowId,
      snapshotHash,
      workflowState,
      schemasByType,
      schemaRefsByType,
      summary: {
        ...summary,
        objective: params.objective || null,
      },
    })

    logger.info('Generated workflow context pack', {
      workflowId: params.workflowId,
      contextPackId: packId,
      schemaCount: Object.keys(schemaRefsByType).length,
    })

    return {
      success: true,
      contextPackId: packId,
      workflowId: params.workflowId,
      snapshotHash,
      summary: {
        ...summary,
        objective: params.objective || null,
      },
      schemaRefsByType,
      availableBlockCatalog: buildAvailableBlockCatalog(schemaRefsByType),
      inScopeSchemas: schemasByType,
    }
  },
}

export const workflowContextExpandServerTool: BaseServerTool<WorkflowContextExpandParams, any> = {
  name: 'workflow_context_expand',
  inputSchema: WorkflowContextExpandInputSchema,
  async execute(params: WorkflowContextExpandParams, context?: { userId: string }): Promise<any> {
    if (!context?.userId) {
      throw new Error('Unauthorized workflow access')
    }

    const contextPack = getContextPack(params.contextPackId)
    if (!contextPack) {
      throw new Error(`Context pack not found or expired: ${params.contextPackId}`)
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: contextPack.workflowId,
      userId: context.userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      throw new Error(authorization.message || 'Unauthorized workflow access')
    }

    const requestedBlockTypes = new Set<string>()
    for (const blockType of params.blockTypes || []) {
      if (blockType) requestedBlockTypes.add(blockType)
    }
    for (const schemaRef of params.schemaRefs || []) {
      const blockType = parseSchemaRefToBlockType(schemaRef)
      if (blockType) requestedBlockTypes.add(blockType)
    }

    const typesToExpand = [...requestedBlockTypes]
    const { schemasByType, schemaRefsByType } = buildSchemasByType(typesToExpand)

    return {
      success: true,
      contextPackId: params.contextPackId,
      workflowId: contextPack.workflowId,
      snapshotHash: contextPack.snapshotHash,
      schemasByType,
      schemaRefsByType,
    }
  },
}
