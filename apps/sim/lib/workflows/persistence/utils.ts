import crypto from 'crypto'
import {
  db,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowSubflows,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import type { DbOrTx } from '@/lib/db/types'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/sanitization/validation'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowDBHelpers')

export type WorkflowDeploymentVersion = InferSelectModel<typeof workflowDeploymentVersion>
type SubflowInsert = InferInsertModel<typeof workflowSubflows>

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

export interface NormalizedWorkflowData {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  isFromNormalizedTables: boolean // Flag to indicate source (true = normalized tables, false = deployed state)
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

export async function loadDeployedWorkflowState(workflowId: string): Promise<DeployedWorkflowData> {
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

    return {
      blocks: state.blocks || {},
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

/**
 * Migrates agent blocks from old format (systemPrompt/userPrompt) to new format (messages array)
 * This ensures backward compatibility for workflows created before the messages-input refactor.
 *
 * @param blocks - Record of block states to migrate
 * @returns Migrated blocks with messages array format for agent blocks
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

        // Only migrate if old format exists and new format doesn't
        if ((systemPrompt || userPrompt) && !messages) {
          const newMessages: Array<{ role: string; content: string }> = []

          // Add system message first (industry standard)
          if (systemPrompt) {
            newMessages.push({
              role: 'system',
              content: typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt),
            })
          }

          // Add user message
          if (userPrompt) {
            let userContent = userPrompt

            // Handle object format (e.g., { input: "..." })
            if (typeof userContent === 'object' && userContent !== null) {
              if ('input' in userContent) {
                userContent = (userContent as any).input
              } else {
                // If it's an object but doesn't have 'input', stringify it
                userContent = JSON.stringify(userContent)
              }
            }

            newMessages.push({
              role: 'user',
              content: String(userContent),
            })
          }

          // Return block with migrated messages subBlock
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

/**
 * Load workflow state from normalized tables
 * Returns null if no data found (fallback to JSON blob)
 */
export async function loadWorkflowFromNormalizedTables(
  workflowId: string
): Promise<NormalizedWorkflowData | null> {
  try {
    // Load all components in parallel
    const [blocks, edges, subflows] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
      db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
      db.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
    ])

    // If no blocks found, assume this workflow hasn't been migrated yet
    if (blocks.length === 0) {
      return null
    }

    // Convert blocks to the expected format
    const blocksMap: Record<string, BlockState> = {}
    blocks.forEach((block) => {
      const blockData = block.data || {}

      const assembled: BlockState = {
        id: block.id,
        type: block.type,
        name: block.name,
        position: {
          x: Number(block.positionX),
          y: Number(block.positionY),
        },
        enabled: block.enabled,
        horizontalHandles: block.horizontalHandles,
        advancedMode: block.advancedMode,
        triggerMode: block.triggerMode,
        height: Number(block.height),
        subBlocks: (block.subBlocks as BlockState['subBlocks']) || {},
        outputs: (block.outputs as BlockState['outputs']) || {},
        data: blockData,
        locked: block.locked,
      }

      blocksMap[block.id] = assembled
    })

    // Sanitize any invalid custom tools in agent blocks to prevent client crashes
    const { blocks: sanitizedBlocks } = sanitizeAgentToolsInBlocks(blocksMap)

    // Migrate old agent block format (systemPrompt/userPrompt) to new messages array format
    // This ensures backward compatibility for workflows created before the messages-input refactor
    const migratedBlocks = migrateAgentBlocksToMessagesFormat(sanitizedBlocks)

    // Convert edges to the expected format
    const edgesArray: Edge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceBlockId,
      target: edge.targetBlockId,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: 'default',
      data: {},
    }))

    // Convert subflows to loops and parallels
    const loops: Record<string, Loop> = {}
    const parallels: Record<string, Parallel> = {}

    subflows.forEach((subflow) => {
      const config = (subflow.config ?? {}) as Partial<Loop & Parallel>

      if (subflow.type === SUBFLOW_TYPES.LOOP) {
        const loopType =
          (config as Loop).loopType === 'for' ||
          (config as Loop).loopType === 'forEach' ||
          (config as Loop).loopType === 'while' ||
          (config as Loop).loopType === 'doWhile'
            ? (config as Loop).loopType
            : 'for'

        const loop: Loop = {
          id: subflow.id,
          nodes: Array.isArray((config as Loop).nodes) ? (config as Loop).nodes : [],
          iterations:
            typeof (config as Loop).iterations === 'number' ? (config as Loop).iterations : 1,
          loopType,
          forEachItems: (config as Loop).forEachItems ?? '',
          whileCondition: (config as Loop).whileCondition ?? '',
          doWhileCondition: (config as Loop).doWhileCondition ?? '',
          enabled: migratedBlocks[subflow.id]?.enabled ?? true,
        }
        loops[subflow.id] = loop

        // Sync block.data with loop config to ensure all fields are present
        // This allows switching between loop types without losing data
        if (migratedBlocks[subflow.id]) {
          const block = migratedBlocks[subflow.id]
          migratedBlocks[subflow.id] = {
            ...block,
            data: {
              ...block.data,
              collection: loop.forEachItems ?? block.data?.collection ?? '',
              whileCondition: loop.whileCondition ?? block.data?.whileCondition ?? '',
              doWhileCondition: loop.doWhileCondition ?? block.data?.doWhileCondition ?? '',
            },
          }
        }
      } else if (subflow.type === SUBFLOW_TYPES.PARALLEL) {
        const parallel: Parallel = {
          id: subflow.id,
          nodes: Array.isArray((config as Parallel).nodes) ? (config as Parallel).nodes : [],
          count: typeof (config as Parallel).count === 'number' ? (config as Parallel).count : 5,
          distribution: (config as Parallel).distribution ?? '',
          parallelType:
            (config as Parallel).parallelType === 'count' ||
            (config as Parallel).parallelType === 'collection'
              ? (config as Parallel).parallelType
              : 'count',
          enabled: migratedBlocks[subflow.id]?.enabled ?? true,
        }
        parallels[subflow.id] = parallel
      } else {
        logger.warn(`Unknown subflow type: ${subflow.type} for subflow ${subflow.id}`)
      }
    })

    return {
      blocks: migratedBlocks,
      edges: edgesArray,
      loops,
      parallels,
      isFromNormalizedTables: true,
    }
  } catch (error) {
    logger.error(`Error loading workflow ${workflowId} from normalized tables:`, error)
    return null
  }
}

/**
 * Save workflow state to normalized tables
 */
export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState
): Promise<{ success: boolean; error?: string }> {
  try {
    const blockRecords = state.blocks as Record<string, BlockState>
    const canonicalLoops = generateLoopBlocks(blockRecords)
    const canonicalParallels = generateParallelBlocks(blockRecords)

    // Start a transaction
    await db.transaction(async (tx) => {
      await Promise.all([
        tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
        tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
        tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
      ])

      // Insert blocks
      if (Object.keys(state.blocks).length > 0) {
        const blockInserts = Object.values(state.blocks).map((block) => ({
          id: block.id,
          workflowId: workflowId,
          type: block.type,
          name: block.name || '',
          positionX: String(block.position?.x || 0),
          positionY: String(block.position?.y || 0),
          enabled: block.enabled ?? true,
          horizontalHandles: block.horizontalHandles ?? true,
          advancedMode: block.advancedMode ?? false,
          triggerMode: block.triggerMode ?? false,
          height: String(block.height || 0),
          subBlocks: block.subBlocks || {},
          outputs: block.outputs || {},
          data: block.data || {},
          parentId: block.data?.parentId || null,
          extent: block.data?.extent || null,
          locked: block.locked ?? false,
        }))

        await tx.insert(workflowBlocks).values(blockInserts)
      }

      // Insert edges
      if (state.edges.length > 0) {
        const edgeInserts = state.edges.map((edge) => ({
          id: edge.id,
          workflowId: workflowId,
          sourceBlockId: edge.source,
          targetBlockId: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
        }))

        await tx.insert(workflowEdges).values(edgeInserts)
      }

      // Insert subflows (loops and parallels)
      const subflowInserts: SubflowInsert[] = []

      // Add loops
      Object.values(canonicalLoops).forEach((loop) => {
        subflowInserts.push({
          id: loop.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.LOOP,
          config: loop,
        })
      })

      // Add parallels
      Object.values(canonicalParallels).forEach((parallel) => {
        subflowInserts.push({
          id: parallel.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.PARALLEL,
          config: parallel,
        })
      })

      if (subflowInserts.length > 0) {
        await tx.insert(workflowSubflows).values(subflowInserts)
      }
    })

    return { success: true }
  } catch (error) {
    logger.error(`Error saving workflow ${workflowId} to normalized tables:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if a workflow exists in normalized tables
 */
export async function workflowExistsInNormalizedTables(workflowId: string): Promise<boolean> {
  try {
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

/**
 * Deploy a workflow by creating a new deployment version
 */
export async function deployWorkflow(params: {
  workflowId: string
  deployedBy: string // User ID of the person deploying
  workflowName?: string
}): Promise<{
  success: boolean
  version?: number
  deploymentVersionId?: string
  deployedAt?: Date
  currentState?: any
  error?: string
}> {
  const { workflowId, deployedBy, workflowName } = params

  try {
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalizedData) {
      return { success: false, error: 'Failed to load workflow state' }
    }

    // Also fetch workflow variables
    const [workflowRecord] = await db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    const currentState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
      variables: workflowRecord?.variables || undefined,
      lastSaved: Date.now(),
    }

    const now = new Date()

    const deployedVersion = await db.transaction(async (tx) => {
      // Get next version number
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql`COALESCE(MAX("version"), 0)` })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      const nextVersion = Number(maxVersion) + 1
      const deploymentVersionId = uuidv4()

      // Deactivate all existing versions
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      // Create new deployment version
      await tx.insert(workflowDeploymentVersion).values({
        id: deploymentVersionId,
        workflowId,
        version: nextVersion,
        state: currentState,
        isActive: true,
        createdBy: deployedBy,
        createdAt: now,
      })

      // Update workflow to deployed
      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt: now,
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

      // Note: Templates are NOT automatically updated on deployment
      // Template updates must be done explicitly through the "Update Template" button

      return { version: nextVersion, deploymentVersionId }
    })

    logger.info(`Deployed workflow ${workflowId} as v${deployedVersion.version}`)

    if (workflowName) {
      try {
        const { PlatformEvents } = await import('@/lib/core/telemetry')

        const blockTypeCounts: Record<string, number> = {}
        for (const block of Object.values(currentState.blocks)) {
          const blockType = block.type || 'unknown'
          blockTypeCounts[blockType] = (blockTypeCounts[blockType] || 0) + 1
        }

        PlatformEvents.workflowDeployed({
          workflowId,
          workflowName,
          blocksCount: Object.keys(currentState.blocks).length,
          edgesCount: currentState.edges.length,
          version: deployedVersion.version,
          loopsCount: Object.keys(currentState.loops).length,
          parallelsCount: Object.keys(currentState.parallels).length,
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
      deployedAt: now,
      currentState,
    }
  } catch (error) {
    logger.error(`Error deploying workflow ${workflowId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/** Input state for ID regeneration - partial to handle external sources */
export interface RegenerateStateInput {
  blocks?: Record<string, BlockState>
  edges?: Edge[]
  loops?: Record<string, Loop>
  parallels?: Record<string, Parallel>
  lastSaved?: number
  variables?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/** Output state after ID regeneration */
interface RegenerateStateOutput {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved: number
  variables?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/**
 * Regenerates all IDs in a workflow state to avoid conflicts when duplicating or using templates
 * Returns a new state with all IDs regenerated and references updated
 */
export function regenerateWorkflowStateIds(state: RegenerateStateInput): RegenerateStateOutput {
  // Create ID mappings
  const blockIdMapping = new Map<string, string>()
  const edgeIdMapping = new Map<string, string>()
  const loopIdMapping = new Map<string, string>()
  const parallelIdMapping = new Map<string, string>()

  // First pass: Create all ID mappings
  // Map block IDs
  Object.keys(state.blocks || {}).forEach((oldId) => {
    blockIdMapping.set(oldId, crypto.randomUUID())
  })

  // Map edge IDs

  ;(state.edges || []).forEach((edge: Edge) => {
    edgeIdMapping.set(edge.id, crypto.randomUUID())
  })

  // Map loop IDs
  Object.keys(state.loops || {}).forEach((oldId) => {
    loopIdMapping.set(oldId, crypto.randomUUID())
  })

  // Map parallel IDs
  Object.keys(state.parallels || {}).forEach((oldId) => {
    parallelIdMapping.set(oldId, crypto.randomUUID())
  })

  // Second pass: Create new state with regenerated IDs and updated references
  const newBlocks: Record<string, BlockState> = {}
  const newEdges: Edge[] = []
  const newLoops: Record<string, Loop> = {}
  const newParallels: Record<string, Parallel> = {}

  // Regenerate blocks with updated references
  Object.entries(state.blocks || {}).forEach(([oldId, block]) => {
    const newId = blockIdMapping.get(oldId)!
    // Duplicated blocks are always unlocked so users can edit them
    const newBlock: BlockState = { ...block, id: newId, locked: false }

    // Update parentId reference if it exists
    if (newBlock.data?.parentId) {
      const newParentId = blockIdMapping.get(newBlock.data.parentId)
      if (newParentId) {
        newBlock.data = { ...newBlock.data, parentId: newParentId }
      }
    }

    // Update any block references in subBlocks
    if (newBlock.subBlocks) {
      const updatedSubBlocks: Record<string, BlockState['subBlocks'][string]> = {}
      Object.entries(newBlock.subBlocks).forEach(([subId, subBlock]) => {
        const updatedSubBlock = { ...subBlock }

        // If subblock value contains block references, update them
        if (
          typeof updatedSubBlock.value === 'string' &&
          blockIdMapping.has(updatedSubBlock.value)
        ) {
          updatedSubBlock.value = blockIdMapping.get(updatedSubBlock.value) ?? updatedSubBlock.value
        }

        updatedSubBlocks[subId] = updatedSubBlock
      })
      newBlock.subBlocks = updatedSubBlocks
    }

    newBlocks[newId] = newBlock
  })

  // Regenerate edges with updated source/target references

  ;(state.edges || []).forEach((edge: Edge) => {
    const newId = edgeIdMapping.get(edge.id)!
    const newSource = blockIdMapping.get(edge.source) || edge.source
    const newTarget = blockIdMapping.get(edge.target) || edge.target

    newEdges.push({
      ...edge,
      id: newId,
      source: newSource,
      target: newTarget,
    })
  })

  // Regenerate loops with updated node references
  Object.entries(state.loops || {}).forEach(([oldId, loop]) => {
    const newId = loopIdMapping.get(oldId)!
    const newLoop: Loop = { ...loop, id: newId }

    // Update nodes array with new block IDs
    if (newLoop.nodes) {
      newLoop.nodes = newLoop.nodes.map((nodeId: string) => blockIdMapping.get(nodeId) || nodeId)
    }

    newLoops[newId] = newLoop
  })

  // Regenerate parallels with updated node references
  Object.entries(state.parallels || {}).forEach(([oldId, parallel]) => {
    const newId = parallelIdMapping.get(oldId)!
    const newParallel: Parallel = { ...parallel, id: newId }

    // Update nodes array with new block IDs
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

/**
 * Undeploy a workflow by deactivating all versions and clearing deployment state.
 * Handles schedule deletion and returns the result.
 */
export async function undeployWorkflow(params: { workflowId: string; tx?: DbOrTx }): Promise<{
  success: boolean
  error?: string
}> {
  const { workflowId, tx } = params

  const executeUndeploy = async (dbCtx: DbOrTx) => {
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
      error: error instanceof Error ? error.message : 'Failed to undeploy workflow',
    }
  }
}

/**
 * Activate a specific deployment version for a workflow.
 * Deactivates the current active version and activates the specified one.
 */
export async function activateWorkflowVersion(params: {
  workflowId: string
  version: number
}): Promise<{
  success: boolean
  deployedAt?: Date
  state?: unknown
  error?: string
}> {
  const { workflowId, version } = params

  try {
    const [versionData] = await db
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
      return { success: false, error: 'Deployment version not found' }
    }

    const now = new Date()

    await db.transaction(async (tx) => {
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
    })

    logger.info(`Activated version ${version} for workflow ${workflowId}`)

    return {
      success: true,
      deployedAt: now,
      state: versionData.state,
    }
  } catch (error) {
    logger.error(`Error activating version ${version} for workflow ${workflowId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to activate version',
    }
  }
}

/**
 * List all deployment versions for a workflow.
 */
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
