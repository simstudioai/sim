import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { getBlock } from '@/blocks/registry'
import { getContextPack, saveContextPack, updateContextPack } from './change-store'
import {
  buildSchemasByType,
  getAllKnownBlockTypes,
  hashWorkflowState,
  loadWorkflowStateFromDb,
  summarizeWorkflowState,
} from './workflow-state'

const logger = createLogger('WorkflowContextServerTool')

const WORKFLOW_HARD_CONSTRAINTS = [
  'No nested subflows: loop/parallel cannot be placed inside loop/parallel.',
  'No cyclic edges: workflow graph must remain acyclic. Use loop/parallel blocks for iteration.',
  'Container handle rules: loop/parallel start handles connect only to children; end handles connect only outside the container.',
  'Executable non-trigger blocks should have an incoming connection unless intentionally disconnected.',
]

const WorkflowContextGetInputSchema = z.object({
  workflowId: z.string(),
  objective: z.string().optional(),
  includeBlockTypes: z.array(z.string()).optional(),
  includeAllSchemas: z.boolean().optional(),
  schemaMode: z.enum(['minimal', 'workflow', 'all']).optional(),
})

type WorkflowContextGetParams = z.infer<typeof WorkflowContextGetInputSchema>

const WorkflowContextExpandInputSchema = z.object({
  contextPackId: z.string(),
  blockTypes: z.array(z.string()).optional(),
  schemaRefs: z.array(z.string()).optional(),
})

type WorkflowContextExpandParams = z.infer<typeof WorkflowContextExpandInputSchema>

const BLOCK_TYPE_ALIAS_MAP: Record<string, string> = {
  start: 'start_trigger',
  starttrigger: 'start_trigger',
  starter: 'start_trigger',
  trigger: 'start_trigger',
  loop: 'loop',
  parallel: 'parallel',
  parallelai: 'parallel',
  hitl: 'human_in_the_loop',
  humanintheloop: 'human_in_the_loop',
  routerv2: 'router_v2',
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function buildBlockTypeIndex(knownTypes: string[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const blockType of knownTypes) {
    const canonicalType = String(blockType || '').trim()
    if (!canonicalType) continue

    const normalizedType = normalizeToken(canonicalType)
    if (normalizedType && !index.has(normalizedType)) {
      index.set(normalizedType, canonicalType)
    }

    const blockConfig = getBlock(canonicalType)
    const displayName = String(blockConfig?.name || '').trim()
    const normalizedDisplayName = normalizeToken(displayName)
    if (normalizedDisplayName && !index.has(normalizedDisplayName)) {
      index.set(normalizedDisplayName, canonicalType)
    }
  }
  return index
}

function resolveBlockTypes(
  requestedBlockTypes: string[],
  knownTypes: string[]
): { resolved: string[]; unresolved: string[] } {
  const index = buildBlockTypeIndex(knownTypes)
  const resolved = new Set<string>()
  const unresolved = new Set<string>()

  for (const rawType of requestedBlockTypes) {
    const normalized = normalizeToken(String(rawType || ''))
    if (!normalized) continue

    const aliasResolved = BLOCK_TYPE_ALIAS_MAP[normalized]
    if (aliasResolved) {
      resolved.add(aliasResolved)
      continue
    }

    const direct = index.get(normalized)
    if (direct) {
      resolved.add(direct)
      continue
    }

    unresolved.add(String(rawType))
  }

  return {
    resolved: [...resolved],
    unresolved: [...unresolved],
  }
}

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

    const knownTypes = getAllKnownBlockTypes()
    const blockTypesInWorkflowRaw = Object.values(workflowState.blocks || {}).map((block: any) =>
      String(block?.type || '')
    )
    const requestedTypesRaw = params.includeBlockTypes || []
    const resolvedWorkflowTypes = resolveBlockTypes(blockTypesInWorkflowRaw, knownTypes).resolved
    const resolvedRequestedTypes = resolveBlockTypes(requestedTypesRaw, knownTypes)
    const schemaMode =
      params.includeAllSchemas === true ? 'all' : (params.schemaMode || 'minimal')
    const candidateTypes =
      schemaMode === 'all'
        ? knownTypes
        : schemaMode === 'workflow'
          ? [...resolvedWorkflowTypes, ...resolvedRequestedTypes.resolved]
          : [...resolvedRequestedTypes.resolved]
    const { schemasByType, schemaRefsByType } = buildSchemasByType(candidateTypes)
    const suggestedSchemaTypes = [...new Set(resolvedWorkflowTypes.filter(Boolean))]

    const summary = summarizeWorkflowState(workflowState)
    const packId = await saveContextPack({
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
      schemaMode,
      summary: {
        ...summary,
        objective: params.objective || null,
      },
      schemaRefsByType,
      availableBlockCatalog: buildAvailableBlockCatalog(schemaRefsByType),
      suggestedSchemaTypes,
      unresolvedRequestedBlockTypes: resolvedRequestedTypes.unresolved,
      knownBlockTypes: knownTypes,
      inScopeSchemas: schemasByType,
      hardConstraints: WORKFLOW_HARD_CONSTRAINTS,
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

    const contextPack = await getContextPack(params.contextPackId)
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

    const knownTypes = getAllKnownBlockTypes()
    const requestedBlockTypesRaw = new Set<string>()
    for (const blockType of params.blockTypes || []) {
      if (blockType) requestedBlockTypesRaw.add(String(blockType))
    }
    for (const schemaRef of params.schemaRefs || []) {
      const blockType = parseSchemaRefToBlockType(schemaRef)
      if (blockType) requestedBlockTypesRaw.add(blockType)
    }

    const resolvedTypes = resolveBlockTypes([...requestedBlockTypesRaw], knownTypes)
    const typesToExpand = resolvedTypes.resolved
    const { schemasByType, schemaRefsByType } = buildSchemasByType(typesToExpand)
    const mergedSchemasByType = {
      ...(contextPack.schemasByType || {}),
      ...schemasByType,
    }
    const mergedSchemaRefsByType = {
      ...(contextPack.schemaRefsByType || {}),
      ...schemaRefsByType,
    }
    const updatedContextPack = await updateContextPack(params.contextPackId, {
      schemasByType: mergedSchemasByType,
      schemaRefsByType: mergedSchemaRefsByType,
    })
    const warnings =
      resolvedTypes.unresolved.length > 0
        ? [
            `Unknown block type(s): ${resolvedTypes.unresolved.join(', ')}. ` +
              'Use known block type IDs from knownBlockTypes.',
          ]
        : []

    return {
      success: true,
      contextPackId: params.contextPackId,
      workflowId: contextPack.workflowId,
      snapshotHash: contextPack.snapshotHash,
      schemasByType,
      schemaRefsByType,
      loadedSchemaTypes: Object.keys(updatedContextPack?.schemasByType || mergedSchemasByType).sort(),
      resolvedBlockTypes: resolvedTypes.resolved,
      unresolvedBlockTypes: resolvedTypes.unresolved,
      knownBlockTypes: knownTypes,
      warnings,
      hardConstraints: WORKFLOW_HARD_CONSTRAINTS,
    }
  },
}
