import crypto from 'crypto'
import {
  db,
  webhook,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowSubflows,
} from '@sim/db'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowDBHelpers')

export type WorkflowDeploymentVersion = InferSelectModel<typeof workflowDeploymentVersion>

export interface WorkflowDeploymentVersionResponse {
  id: string
  version: number
  name?: string | null
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
  workflowId: string
): Promise<NormalizedWorkflowData> {
  try {
    const [active] = await db
      .select({
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

    const state = active.state as WorkflowState

    return {
      blocks: state.blocks || {},
      edges: state.edges || [],
      loops: state.loops || {},
      parallels: state.parallels || {},
      isFromNormalizedTables: false,
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
      // Snapshot existing webhooks before deletion to preserve them through the cycle
      let existingWebhooks: any[] = []
      try {
        existingWebhooks = await tx.select().from(webhook).where(eq(webhook.workflowId, workflowId))
      } catch (webhookError) {
        // Webhook table might not be available in test environments
        logger.debug('Could not load webhooks before save, skipping preservation', {
          error: webhookError instanceof Error ? webhookError.message : String(webhookError),
        })
      }

      // Clear existing data for this workflow
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
      const subflowInserts: any[] = []

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

      // Re-insert preserved webhooks if any exist and their blocks still exist
      if (existingWebhooks.length > 0) {
        try {
          const webhookInserts = existingWebhooks
            .filter((wh) => !!state.blocks?.[wh.blockId ?? ''])
            .map((wh) => ({
              id: wh.id,
              workflowId: wh.workflowId,
              blockId: wh.blockId,
              path: wh.path,
              provider: wh.provider,
              providerConfig: wh.providerConfig,
              isActive: wh.isActive,
              createdAt: wh.createdAt,
              updatedAt: new Date(),
            }))

          if (webhookInserts.length > 0) {
            await tx.insert(webhook).values(webhookInserts)
            logger.debug(`Preserved ${webhookInserts.length} webhook(s) through workflow save`, {
              workflowId,
            })
          }
        } catch (webhookInsertError) {
          // Webhook preservation is optional - don't fail the entire save if it errors
          logger.warn('Could not preserve webhooks during save', {
            error:
              webhookInsertError instanceof Error
                ? webhookInsertError.message
                : String(webhookInsertError),
            workflowId,
          })
        }
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

      // Deactivate all existing versions
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      // Create new deployment version
      await tx.insert(workflowDeploymentVersion).values({
        id: uuidv4(),
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

      return nextVersion
    })

    logger.info(`Deployed workflow ${workflowId} as v${deployedVersion}`)

    // Track deployment telemetry if workflow name is provided
    if (workflowName) {
      try {
        const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')

        const blockTypeCounts: Record<string, number> = {}
        for (const block of Object.values(currentState.blocks)) {
          const blockType = (block as any).type || 'unknown'
          blockTypeCounts[blockType] = (blockTypeCounts[blockType] || 0) + 1
        }

        trackPlatformEvent('platform.workflow.deployed', {
          'workflow.id': workflowId,
          'workflow.name': workflowName,
          'workflow.blocks_count': Object.keys(currentState.blocks).length,
          'workflow.edges_count': currentState.edges.length,
          'workflow.loops_count': Object.keys(currentState.loops).length,
          'workflow.parallels_count': Object.keys(currentState.parallels).length,
          'workflow.block_types': JSON.stringify(blockTypeCounts),
          'deployment.version': deployedVersion,
        })
      } catch (telemetryError) {
        logger.warn(`Failed to track deployment telemetry for ${workflowId}`, telemetryError)
      }
    }

    return {
      success: true,
      version: deployedVersion,
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

/**
 * Regenerates all IDs in a workflow state to avoid conflicts when duplicating or using templates
 * Returns a new state with all IDs regenerated and references updated
 */
export function regenerateWorkflowStateIds(state: any): any {
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

  ;(state.edges || []).forEach((edge: any) => {
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
  const newBlocks: Record<string, any> = {}
  const newEdges: any[] = []
  const newLoops: Record<string, any> = {}
  const newParallels: Record<string, any> = {}

  // Regenerate blocks with updated references
  Object.entries(state.blocks || {}).forEach(([oldId, block]: [string, any]) => {
    const newId = blockIdMapping.get(oldId)!
    const newBlock = { ...block, id: newId }

    // Update parentId reference if it exists
    if (newBlock.data?.parentId) {
      const newParentId = blockIdMapping.get(newBlock.data.parentId)
      if (newParentId) {
        newBlock.data.parentId = newParentId
      }
    }

    // Update any block references in subBlocks
    if (newBlock.subBlocks) {
      const updatedSubBlocks: Record<string, any> = {}
      Object.entries(newBlock.subBlocks).forEach(([subId, subBlock]: [string, any]) => {
        const updatedSubBlock = { ...subBlock }

        // If subblock value contains block references, update them
        if (
          typeof updatedSubBlock.value === 'string' &&
          blockIdMapping.has(updatedSubBlock.value)
        ) {
          updatedSubBlock.value = blockIdMapping.get(updatedSubBlock.value)
        }

        updatedSubBlocks[subId] = updatedSubBlock
      })
      newBlock.subBlocks = updatedSubBlocks
    }

    newBlocks[newId] = newBlock
  })

  // Regenerate edges with updated source/target references

  ;(state.edges || []).forEach((edge: any) => {
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
  Object.entries(state.loops || {}).forEach(([oldId, loop]: [string, any]) => {
    const newId = loopIdMapping.get(oldId)!
    const newLoop = { ...loop, id: newId }

    // Update nodes array with new block IDs
    if (newLoop.nodes) {
      newLoop.nodes = newLoop.nodes.map((nodeId: string) => blockIdMapping.get(nodeId) || nodeId)
    }

    newLoops[newId] = newLoop
  })

  // Regenerate parallels with updated node references
  Object.entries(state.parallels || {}).forEach(([oldId, parallel]: [string, any]) => {
    const newId = parallelIdMapping.get(oldId)!
    const newParallel = { ...parallel, id: newId }

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
