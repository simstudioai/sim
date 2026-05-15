import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getActiveWorkflowContext } from '@sim/workflow-authz'
import {
  loadWorkflowFromNormalizedTablesRaw,
  persistMigratedBlocks,
} from '@sim/workflow-persistence/load'
import { saveWorkflowToNormalizedTables as saveWorkflowToNormalizedTablesRaw } from '@sim/workflow-persistence/save'
import type { DbOrTx, NormalizedWorkflowData } from '@sim/workflow-persistence/types'
import type { BlockState, Loop, Parallel, WorkflowState } from '@sim/workflow-types/workflow'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import { remapConditionBlockIds, remapConditionEdgeHandle } from '@/lib/workflows/condition-ids'
import {
  backfillCanonicalModes,
  migrateSubblockIds,
} from '@/lib/workflows/migrations/subblock-migrations'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/sanitization/validation'

const logger = createLogger('WorkflowDBHelpers')

export type { DbOrTx, NormalizedWorkflowData } from '@sim/workflow-persistence/types'

export type WorkflowDeploymentVersion = InferSelectModel<typeof workflowDeploymentVersion>

function hasReturnedRows(result: unknown): boolean {
  if (Array.isArray(result)) return result.length > 0

  if (result && typeof result === 'object') {
    const rows = 'rows' in result ? result.rows : undefined
    if (Array.isArray(rows)) return rows.length > 0
  }

  return Boolean(result)
}

async function lockWorkflowForUpdate(tx: DbOrTx, workflowId: string): Promise<boolean> {
  const query = tx.select({ id: workflow.id }).from(workflow).where(eq(workflow.id, workflowId))

  if ('limit' in query && typeof query.limit === 'function') {
    const limited = query.limit(1)
    const rows =
      'for' in limited && typeof limited.for === 'function'
        ? await limited.for('update')
        : await limited
    return hasReturnedRows(rows)
  }

  const rows = await query

  return hasReturnedRows(rows)
}

export interface WorkflowDeploymentVersionResponse {
  id: string
  version: number
  name?: string | null
  description?: string | null
  isActive: boolean
  createdAt: string
  createdBy?: string | null
  deployedBy?: string | null
}

export interface DeployedWorkflowData extends NormalizedWorkflowData {
  deploymentVersionId: string
  variables?: Record<string, unknown>
}

export async function blockExistsInDeployment(
  workflowId: string,
  blockId: string
): Promise<boolean> {
  try {
    const [result] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!result?.state) {
      return false
    }

    const state = result.state as WorkflowState
    return !!state.blocks?.[blockId]
  } catch (error) {
    logger.error(`Error checking block ${blockId} in deployment for workflow ${workflowId}:`, error)
    return false
  }
}

export async function loadDeployedWorkflowState(
  workflowId: string,
  providedWorkspaceId?: string
): Promise<DeployedWorkflowData> {
  try {
    const [active] = await db
      .select({
        id: workflowDeploymentVersion.id,
        state: workflowDeploymentVersion.state,
        createdAt: workflowDeploymentVersion.createdAt,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (!active?.state) {
      throw new Error(`Workflow ${workflowId} has no active deployment`)
    }

    const state = active.state as WorkflowState & { variables?: Record<string, unknown> }

    let resolvedWorkspaceId = providedWorkspaceId
    if (!resolvedWorkspaceId) {
      const workflowContext = await getActiveWorkflowContext(workflowId)
      resolvedWorkspaceId = workflowContext?.workspaceId
    }

    if (!resolvedWorkspaceId) {
      throw new Error(`Workflow ${workflowId} has no workspace`)
    }

    const { blocks: migratedBlocks } = await applyBlockMigrations(
      state.blocks || {},
      resolvedWorkspaceId
    )

    return {
      blocks: migratedBlocks,
      edges: state.edges || [],
      loops: state.loops || {},
      parallels: state.parallels || {},
      variables: state.variables || {},
      isFromNormalizedTables: false,
      deploymentVersionId: active.id,
    }
  } catch (error) {
    logger.error(`Error loading deployed workflow state ${workflowId}:`, error)
    throw error
  }
}

interface MigrationContext {
  blocks: Record<string, BlockState>
  workspaceId: string
  migrated: boolean
}

type BlockMigration = (ctx: MigrationContext) => MigrationContext | Promise<MigrationContext>

function createMigrationPipeline(migrations: BlockMigration[]) {
  return async (
    blocks: Record<string, BlockState>,
    workspaceId: string
  ): Promise<{ blocks: Record<string, BlockState>; migrated: boolean }> => {
    let ctx: MigrationContext = { blocks, workspaceId, migrated: false }
    for (const migration of migrations) {
      ctx = await migration(ctx)
    }
    return { blocks: ctx.blocks, migrated: ctx.migrated }
  }
}

const applyBlockMigrations = createMigrationPipeline([
  (ctx) => {
    const { blocks } = sanitizeAgentToolsInBlocks(ctx.blocks)
    return { ...ctx, blocks }
  },

  (ctx) => ({
    ...ctx,
    blocks: migrateAgentBlocksToMessagesFormat(ctx.blocks),
  }),

  (ctx) => {
    const { blocks, migrated } = migrateSubblockIds(ctx.blocks)
    return { ...ctx, blocks, migrated: ctx.migrated || migrated }
  },

  async (ctx) => {
    const { blocks, migrated } = await migrateCredentialIds(ctx.blocks, ctx.workspaceId)
    return { ...ctx, blocks, migrated: ctx.migrated || migrated }
  },

  (ctx) => {
    const { blocks, migrated } = backfillCanonicalModes(ctx.blocks)
    return { ...ctx, blocks, migrated: ctx.migrated || migrated }
  },
])

/**
 * Migrates agent blocks from old format (systemPrompt/userPrompt) to new format (messages array)
 */
export function migrateAgentBlocksToMessagesFormat(
  blocks: Record<string, BlockState>
): Record<string, BlockState> {
  return Object.fromEntries(
    Object.entries(blocks).map(([id, block]) => {
      if (block.type === 'agent') {
        const systemPrompt = block.subBlocks.systemPrompt?.value
        const userPrompt = block.subBlocks.userPrompt?.value
        const messages = block.subBlocks.messages?.value

        if ((systemPrompt || userPrompt) && !messages) {
          const newMessages: Array<{ role: string; content: string }> = []

          if (systemPrompt) {
            newMessages.push({
              role: 'system',
              content: typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt),
            })
          }

          if (userPrompt) {
            let userContent = userPrompt

            if (typeof userContent === 'object' && userContent !== null) {
              if ('input' in userContent) {
                userContent = (userContent as any).input
              } else {
                userContent = JSON.stringify(userContent)
              }
            }

            newMessages.push({
              role: 'user',
              content: String(userContent),
            })
          }

          return [
            id,
            {
              ...block,
              subBlocks: {
                ...block.subBlocks,
                messages: {
                  id: 'messages',
                  type: 'messages-input',
                  value: newMessages,
                },
              },
            },
          ]
        }
      }
      return [id, block]
    })
  )
}

export const CREDENTIAL_SUBBLOCK_IDS = new Set([
  'credential',
  'manualCredential',
  'triggerCredentials',
])

async function migrateCredentialIds(
  blocks: Record<string, BlockState>,
  workspaceId: string
): Promise<{ blocks: Record<string, BlockState>; migrated: boolean }> {
  const potentialLegacyIds = new Set<string>()

  for (const block of Object.values(blocks)) {
    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks || {})) {
      if (!subBlock || typeof subBlock !== 'object') continue
      const value = (subBlock as { value?: unknown }).value
      if (
        CREDENTIAL_SUBBLOCK_IDS.has(subBlockId) &&
        typeof value === 'string' &&
        value &&
        !value.startsWith('cred_')
      ) {
        potentialLegacyIds.add(value)
      }

      if (subBlockId === 'tools' && Array.isArray(value)) {
        for (const tool of value) {
          const credParam = tool?.params?.credential
          if (typeof credParam === 'string' && credParam && !credParam.startsWith('cred_')) {
            potentialLegacyIds.add(credParam)
          }
        }
      }
    }
  }

  if (potentialLegacyIds.size === 0) {
    return { blocks, migrated: false }
  }

  const rows = await db
    .select({ id: credential.id, accountId: credential.accountId })
    .from(credential)
    .where(
      and(
        inArray(credential.accountId, [...potentialLegacyIds]),
        eq(credential.workspaceId, workspaceId)
      )
    )

  if (rows.length === 0) {
    return { blocks, migrated: false }
  }

  const accountToCredential = new Map(rows.map((r) => [r.accountId!, r.id]))

  const migratedBlocks = Object.fromEntries(
    Object.entries(blocks).map(([blockId, block]) => {
      let blockChanged = false
      const newSubBlocks = { ...block.subBlocks }

      for (const [subBlockId, subBlock] of Object.entries(newSubBlocks)) {
        if (CREDENTIAL_SUBBLOCK_IDS.has(subBlockId) && typeof subBlock.value === 'string') {
          const newId = accountToCredential.get(subBlock.value)
          if (newId) {
            newSubBlocks[subBlockId] = { ...subBlock, value: newId }
            blockChanged = true
          }
        }

        if (subBlockId === 'tools' && Array.isArray(subBlock.value)) {
          let toolsChanged = false
          const newTools = (subBlock.value as any[]).map((tool: any) => {
            const credParam = tool?.params?.credential
            if (typeof credParam === 'string') {
              const newId = accountToCredential.get(credParam)
              if (newId) {
                toolsChanged = true
                return { ...tool, params: { ...tool.params, credential: newId } }
              }
            }
            return tool
          })
          if (toolsChanged) {
            newSubBlocks[subBlockId] = { ...subBlock, value: newTools as any }
            blockChanged = true
          }
        }
      }

      return [blockId, blockChanged ? { ...block, subBlocks: newSubBlocks } : block]
    })
  )

  const anyBlockChanged = Object.keys(migratedBlocks).some(
    (id) => migratedBlocks[id] !== blocks[id]
  )

  return { blocks: migratedBlocks, migrated: anyBlockChanged }
}

/**
 * Load workflow from normalized tables and apply all block migrations
 * (credential ID rewrites, agent message migration, subblock ID migrations,
 * canonical-mode backfill, tool sanitization). Returns null if the workflow
 * has not been migrated to normalized tables yet.
 */
export async function loadWorkflowFromNormalizedTables(
  workflowId: string,
  externalTx?: DbOrTx
): Promise<NormalizedWorkflowData | null> {
  const raw = await loadWorkflowFromNormalizedTablesRaw(workflowId, externalTx)
  if (!raw) return null

  const { blocks: finalBlocks, migrated } = await applyBlockMigrations(raw.blocks, raw.workspaceId)

  if (migrated) {
    Promise.resolve().then(() =>
      persistMigratedBlocks(workflowId, raw.blocks, finalBlocks, raw.blockUpdatedAtById)
    )
  }

  const patchedLoops: Record<string, Loop> = { ...raw.loops }
  const patchedParallels: Record<string, Parallel> = { ...raw.parallels }

  for (const id of Object.keys(raw.loops)) {
    if (finalBlocks[id]) {
      patchedLoops[id] = { ...raw.loops[id], enabled: finalBlocks[id].enabled ?? true }
    }
  }
  for (const id of Object.keys(raw.parallels)) {
    if (finalBlocks[id]) {
      patchedParallels[id] = {
        ...raw.parallels[id],
        enabled: finalBlocks[id].enabled ?? true,
      }
    }
  }

  return {
    blocks: finalBlocks,
    edges: raw.edges,
    loops: patchedLoops,
    parallels: patchedParallels,
    isFromNormalizedTables: true,
  }
}

export async function loadWorkflowDeploymentSnapshot(
  workflowId: string,
  externalTx?: DbOrTx
): Promise<WorkflowState | null> {
  const loadSnapshot = async (tx: DbOrTx) => {
    const [normalizedData, [workflowRecord]] = await Promise.all([
      loadWorkflowFromNormalizedTables(workflowId, tx),
      tx
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1),
    ])

    if (!normalizedData) return null

    return buildWorkflowDeploymentSnapshot(normalizedData, workflowRecord?.variables)
  }

  if (externalTx) {
    return loadSnapshot(externalTx)
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    return loadSnapshot(tx)
  })
}

export function buildWorkflowDeploymentSnapshot(
  normalizedData: NormalizedWorkflowData,
  variables: unknown
): WorkflowState {
  return {
    blocks: normalizedData.blocks,
    edges: normalizedData.edges,
    loops: normalizedData.loops,
    parallels: normalizedData.parallels,
    variables: (variables as WorkflowState['variables']) || {},
    lastSaved: Date.now(),
  }
}

export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState,
  externalTx?: DbOrTx
): Promise<{ success: boolean; error?: string }> {
  if (externalTx) {
    return saveWorkflowToNormalizedTablesRaw(workflowId, state, externalTx)
  }

  try {
    return await db.transaction(async (tx) => {
      await lockWorkflowForUpdate(tx, workflowId)
      return saveWorkflowToNormalizedTablesRaw(workflowId, state, tx)
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to save workflow state')
    logger.error(`Error saving workflow ${workflowId} to normalized tables:`, error)
    return { success: false, error: message }
  }
}

export async function workflowExistsInNormalizedTables(workflowId: string): Promise<boolean> {
  try {
    const { workflowBlocks } = await import('@sim/db')
    const blocks = await db
      .select({ id: workflowBlocks.id })
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))
      .limit(1)

    return blocks.length > 0
  } catch (error) {
    logger.error(`Error checking if workflow ${workflowId} exists in normalized tables:`, error)
    return false
  }
}

type DeployWorkflowValidationResult =
  | { success: true }
  | { success: false; error: string; errorCode?: 'validation' }

export async function deployWorkflow(params: {
  workflowId: string
  deployedBy: string
  workflowName?: string
  workflowState?: WorkflowState
  validateWorkflowState?: (
    workflowState: WorkflowState
  ) => DeployWorkflowValidationResult | Promise<DeployWorkflowValidationResult>
  onDeployTransaction?: (
    tx: DbOrTx,
    result: { deploymentVersionId: string; version: number; previousVersionId?: string }
  ) => Promise<void>
}): Promise<{
  success: boolean
  version?: number
  deploymentVersionId?: string
  deployedAt?: Date
  previousVersionId?: string
  currentState?: WorkflowState
  error?: string
  errorCode?: 'validation' | 'not_found'
}> {
  const { workflowId, deployedBy, workflowName } = params

  try {
    const now = new Date()
    let currentState: WorkflowState | null = null

    const deployedVersion = await db.transaction(async (tx) => {
      if (!(await lockWorkflowForUpdate(tx, workflowId))) {
        return {
          success: false as const,
          error: 'Workflow not found',
          errorCode: 'not_found' as const,
        }
      }

      currentState = params.workflowState ?? (await loadWorkflowDeploymentSnapshot(workflowId, tx))
      if (!currentState) {
        return {
          success: false as const,
          error: 'Failed to load workflow state',
          errorCode: 'validation' as const,
        }
      }

      const validationError = await params.validateWorkflowState?.(currentState)
      if (validationError && !validationError.success) {
        return {
          success: false as const,
          error: validationError.error,
          errorCode: validationError.errorCode,
        }
      }

      const [currentActiveVersion] = await tx
        .select({ id: workflowDeploymentVersion.id })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .limit(1)
      const previousVersionId = currentActiveVersion?.id

      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql`COALESCE(MAX("version"), 0)` })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      const nextVersion = Number(maxVersion) + 1
      const deploymentVersionId = generateId()

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      await tx.insert(workflowDeploymentVersion).values({
        id: deploymentVersionId,
        workflowId,
        version: nextVersion,
        state: currentState,
        isActive: true,
        createdBy: deployedBy,
        createdAt: now,
      })

      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt: now,
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

      await params.onDeployTransaction?.(tx, {
        deploymentVersionId,
        version: nextVersion,
        previousVersionId,
      })

      return {
        success: true as const,
        version: nextVersion,
        deploymentVersionId,
        previousVersionId,
        currentState,
      }
    })

    if (!deployedVersion.success) {
      return {
        success: false,
        error: deployedVersion.error,
        errorCode: deployedVersion.errorCode,
      }
    }
    const deployedState = deployedVersion.currentState
    if (!deployedState) {
      return { success: false, error: 'Failed to load workflow state' }
    }

    logger.info(`Deployed workflow ${workflowId} as v${deployedVersion.version}`)

    if (workflowName) {
      try {
        const { PlatformEvents } = await import('@/lib/core/telemetry')

        const blockTypeCounts: Record<string, number> = {}
        for (const block of Object.values(deployedState.blocks)) {
          const blockType = block.type || 'unknown'
          blockTypeCounts[blockType] = (blockTypeCounts[blockType] || 0) + 1
        }

        PlatformEvents.workflowDeployed({
          workflowId,
          workflowName,
          blocksCount: Object.keys(deployedState.blocks).length,
          edgesCount: deployedState.edges.length,
          version: deployedVersion.version,
          loopsCount: Object.keys(deployedState.loops).length,
          parallelsCount: Object.keys(deployedState.parallels).length,
          blockTypes: JSON.stringify(blockTypeCounts),
        })
      } catch (telemetryError) {
        logger.warn(`Failed to track deployment telemetry for ${workflowId}`, telemetryError)
      }
    }

    return {
      success: true,
      version: deployedVersion.version,
      deploymentVersionId: deployedVersion.deploymentVersionId,
      previousVersionId: deployedVersion.previousVersionId,
      deployedAt: now,
      currentState: deployedState,
    }
  } catch (error) {
    logger.error(`Error deploying workflow ${workflowId}:`, error)
    return {
      success: false,
      error: getErrorMessage(error, 'Unknown error'),
    }
  }
}

export interface RegenerateStateInput {
  blocks?: Record<string, BlockState>
  edges?: Edge[]
  loops?: Record<string, Loop>
  parallels?: Record<string, Parallel>
  lastSaved?: number
  variables?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface RegenerateStateOutput {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved: number
  variables?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export function regenerateWorkflowStateIds(state: RegenerateStateInput): RegenerateStateOutput {
  const blockIdMapping = new Map<string, string>()
  const edgeIdMapping = new Map<string, string>()
  const loopIdMapping = new Map<string, string>()
  const parallelIdMapping = new Map<string, string>()

  Object.keys(state.blocks || {}).forEach((oldId) => {
    blockIdMapping.set(oldId, generateId())
  })

  ;(state.edges || []).forEach((edge: Edge) => {
    edgeIdMapping.set(edge.id, generateId())
  })

  Object.keys(state.loops || {}).forEach((oldId) => {
    loopIdMapping.set(oldId, generateId())
  })

  Object.keys(state.parallels || {}).forEach((oldId) => {
    parallelIdMapping.set(oldId, generateId())
  })

  const newBlocks: Record<string, BlockState> = {}
  const newEdges: Edge[] = []
  const newLoops: Record<string, Loop> = {}
  const newParallels: Record<string, Parallel> = {}

  Object.entries(state.blocks || {}).forEach(([oldId, block]) => {
    const newId = blockIdMapping.get(oldId)!
    const newBlock: BlockState = {
      ...block,
      id: newId,
      subBlocks: structuredClone(block.subBlocks),
      locked: false,
    }

    if (newBlock.data?.parentId) {
      const newParentId = blockIdMapping.get(newBlock.data.parentId)
      if (newParentId) {
        newBlock.data = { ...newBlock.data, parentId: newParentId }
      }
    }

    if (newBlock.subBlocks) {
      const updatedSubBlocks: Record<string, BlockState['subBlocks'][string]> = {}
      Object.entries(newBlock.subBlocks).forEach(([subId, subBlock]) => {
        const updatedSubBlock = { ...subBlock }

        if (
          typeof updatedSubBlock.value === 'string' &&
          blockIdMapping.has(updatedSubBlock.value)
        ) {
          updatedSubBlock.value = blockIdMapping.get(updatedSubBlock.value) ?? updatedSubBlock.value
        }

        if (
          (updatedSubBlock.type === 'condition-input' || updatedSubBlock.type === 'router-input') &&
          typeof updatedSubBlock.value === 'string'
        ) {
          try {
            const parsed = JSON.parse(updatedSubBlock.value)
            if (Array.isArray(parsed) && remapConditionBlockIds(parsed, oldId, newId)) {
              updatedSubBlock.value = JSON.stringify(parsed)
            }
          } catch {}
        }

        updatedSubBlocks[subId] = updatedSubBlock
      })
      newBlock.subBlocks = updatedSubBlocks
    }

    newBlocks[newId] = newBlock
  })

  ;(state.edges || []).forEach((edge: Edge) => {
    const newId = edgeIdMapping.get(edge.id)!
    const newSource = blockIdMapping.get(edge.source) || edge.source
    const newTarget = blockIdMapping.get(edge.target) || edge.target
    const newSourceHandle =
      edge.sourceHandle && blockIdMapping.has(edge.source)
        ? remapConditionEdgeHandle(edge.sourceHandle, edge.source, newSource)
        : edge.sourceHandle

    newEdges.push({
      ...edge,
      id: newId,
      source: newSource,
      target: newTarget,
      sourceHandle: newSourceHandle,
    })
  })

  Object.entries(state.loops || {}).forEach(([oldId, loop]) => {
    const newId = loopIdMapping.get(oldId)!
    const newLoop: Loop = { ...loop, id: newId }

    if (newLoop.nodes) {
      newLoop.nodes = newLoop.nodes.map((nodeId: string) => blockIdMapping.get(nodeId) || nodeId)
    }

    newLoops[newId] = newLoop
  })

  Object.entries(state.parallels || {}).forEach(([oldId, parallel]) => {
    const newId = parallelIdMapping.get(oldId)!
    const newParallel: Parallel = { ...parallel, id: newId }

    if (newParallel.nodes) {
      newParallel.nodes = newParallel.nodes.map(
        (nodeId: string) => blockIdMapping.get(nodeId) || nodeId
      )
    }

    newParallels[newId] = newParallel
  })

  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    lastSaved: state.lastSaved || Date.now(),
    ...(state.variables && { variables: state.variables }),
    ...(state.metadata && { metadata: state.metadata }),
  }
}

export async function undeployWorkflow(params: {
  workflowId: string
  tx?: DbOrTx
  onUndeployTransaction?: (tx: DbOrTx, result: { deploymentVersionIds: string[] }) => Promise<void>
}): Promise<{
  success: boolean
  error?: string
}> {
  const { workflowId, tx } = params

  const executeUndeploy = async (dbCtx: DbOrTx) => {
    if (!(await lockWorkflowForUpdate(dbCtx, workflowId))) {
      throw new Error('Workflow not found')
    }

    const deploymentVersions = await dbCtx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
    const deploymentVersionIds = deploymentVersions.map((version) => version.id)

    const { deleteSchedulesForWorkflow } = await import('@/lib/workflows/schedules/deploy')
    await deleteSchedulesForWorkflow(workflowId, dbCtx)

    await dbCtx
      .update(workflowDeploymentVersion)
      .set({ isActive: false })
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))

    await dbCtx
      .update(workflow)
      .set({ isDeployed: false, deployedAt: null })
      .where(eq(workflow.id, workflowId))

    await params.onUndeployTransaction?.(dbCtx, { deploymentVersionIds })
  }

  try {
    if (tx) {
      await executeUndeploy(tx)
    } else {
      await db.transaction(async (txn) => {
        await executeUndeploy(txn)
      })
    }

    logger.info(`Undeployed workflow ${workflowId}`)
    return { success: true }
  } catch (error) {
    logger.error(`Error undeploying workflow ${workflowId}:`, error)
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to undeploy workflow'),
    }
  }
}

export async function activateWorkflowVersion(params: {
  workflowId: string
  version: number
  onActivateTransaction?: (
    tx: DbOrTx,
    result: { deploymentVersionId: string; previousVersionId?: string }
  ) => Promise<void>
}): Promise<{
  success: boolean
  deployedAt?: Date
  state?: unknown
  previousVersionId?: string
  error?: string
}> {
  const { workflowId, version } = params

  try {
    const now = new Date()
    let versionState: unknown

    const result = await db.transaction(async (tx) => {
      if (!(await lockWorkflowForUpdate(tx, workflowId))) {
        return { success: false as const, error: 'Workflow not found' }
      }

      const [currentActiveVersion] = await tx
        .select({ id: workflowDeploymentVersion.id })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .limit(1)

      const [versionData] = await tx
        .select({ id: workflowDeploymentVersion.id, state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.version, version)
          )
        )
        .limit(1)

      if (!versionData) {
        return { success: false as const, error: 'Deployment version not found' }
      }
      versionState = versionData.state

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: true })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.version, version)
          )
        )

      await tx
        .update(workflow)
        .set({ isDeployed: true, deployedAt: now })
        .where(eq(workflow.id, workflowId))

      await params.onActivateTransaction?.(tx, {
        deploymentVersionId: versionData.id,
        previousVersionId: currentActiveVersion?.id,
      })

      return { success: true as const, previousVersionId: currentActiveVersion?.id }
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    logger.info(`Activated version ${version} for workflow ${workflowId}`)

    return {
      success: true,
      deployedAt: now,
      state: versionState,
      previousVersionId: result.previousVersionId,
    }
  } catch (error) {
    logger.error(`Error activating version ${version} for workflow ${workflowId}:`, error)
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to activate version'),
    }
  }
}

async function activateWorkflowVersionById(params: {
  workflowId: string
  deploymentVersionId: string
}): Promise<{
  success: boolean
  deployedAt?: Date
  state?: unknown
  previousVersionId?: string
  error?: string
}> {
  const { workflowId, deploymentVersionId } = params

  try {
    const now = new Date()
    let versionState: unknown

    const result = await db.transaction(async (tx) => {
      if (!(await lockWorkflowForUpdate(tx, workflowId))) {
        return { success: false as const, error: 'Workflow not found' }
      }

      const [currentActiveVersion] = await tx
        .select({ id: workflowDeploymentVersion.id })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .limit(1)

      const [versionData] = await tx
        .select({ id: workflowDeploymentVersion.id, state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.id, deploymentVersionId)
          )
        )
        .limit(1)

      if (!versionData) {
        return { success: false as const, error: 'Deployment version not found' }
      }
      versionState = versionData.state

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: true })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.id, deploymentVersionId)
          )
        )

      await tx
        .update(workflow)
        .set({ isDeployed: true, deployedAt: now })
        .where(eq(workflow.id, workflowId))

      return { success: true as const, previousVersionId: currentActiveVersion?.id }
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    logger.info(`Activated deployment version ${deploymentVersionId} for workflow ${workflowId}`)

    return {
      success: true,
      deployedAt: now,
      state: versionState,
      previousVersionId: result.previousVersionId,
    }
  } catch (error) {
    logger.error(
      `Error activating deployment version ${deploymentVersionId} for workflow ${workflowId}:`,
      error
    )
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to activate version'),
    }
  }
}

export async function listWorkflowVersions(workflowId: string): Promise<{
  versions: Array<{
    id: string
    version: number
    name: string | null
    isActive: boolean
    createdAt: Date
    createdBy: string | null
    deployedByName: string | null
  }>
}> {
  const { user } = await import('@sim/db')

  const versions = await db
    .select({
      id: workflowDeploymentVersion.id,
      version: workflowDeploymentVersion.version,
      name: workflowDeploymentVersion.name,
      isActive: workflowDeploymentVersion.isActive,
      createdAt: workflowDeploymentVersion.createdAt,
      createdBy: workflowDeploymentVersion.createdBy,
      deployedByName: user.name,
    })
    .from(workflowDeploymentVersion)
    .leftJoin(user, eq(workflowDeploymentVersion.createdBy, user.id))
    .where(eq(workflowDeploymentVersion.workflowId, workflowId))
    .orderBy(desc(workflowDeploymentVersion.version))

  return { versions }
}
