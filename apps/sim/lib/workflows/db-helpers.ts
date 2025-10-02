import {
  db,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowSubflows,
} from '@sim/db'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDBHelpers')

// Database types
export type WorkflowDeploymentVersion = InferSelectModel<typeof workflowDeploymentVersion>

// API response types (dates are serialized as strings)
export interface WorkflowDeploymentVersionResponse {
  id: string
  version: number
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
        isWide: block.isWide,
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
        const loop: Loop = {
          id: subflow.id,
          nodes: Array.isArray((config as Loop).nodes) ? (config as Loop).nodes : [],
          iterations:
            typeof (config as Loop).iterations === 'number' ? (config as Loop).iterations : 1,
          loopType:
            (config as Loop).loopType === 'for' || (config as Loop).loopType === 'forEach'
              ? (config as Loop).loopType
              : 'for',
          forEachItems: (config as Loop).forEachItems ?? '',
        }
        loops[subflow.id] = loop
      } else if (subflow.type === SUBFLOW_TYPES.PARALLEL) {
        const parallel: Parallel = {
          id: subflow.id,
          nodes: Array.isArray((config as Parallel).nodes) ? (config as Parallel).nodes : [],
          count: typeof (config as Parallel).count === 'number' ? (config as Parallel).count : 2,
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
      blocks: sanitizedBlocks,
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
    // Start a transaction
    await db.transaction(async (tx) => {
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
          isWide: block.isWide ?? false,
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
      Object.values(state.loops || {}).forEach((loop) => {
        subflowInserts.push({
          id: loop.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.LOOP,
          config: loop,
        })
      })

      // Add parallels
      Object.values(state.parallels || {}).forEach((parallel) => {
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
 * Migrate a workflow from JSON blob to normalized tables
 */
export async function migrateWorkflowToNormalizedTables(
  workflowId: string,
  jsonState: any
): Promise<{ success: boolean; error?: string }> {
  try {
    // Convert JSON state to WorkflowState format
    // Only include fields that are actually persisted to normalized tables
    const workflowState: WorkflowState = {
      blocks: jsonState.blocks || {},
      edges: jsonState.edges || [],
      loops: jsonState.loops || {},
      parallels: jsonState.parallels || {},
      lastSaved: jsonState.lastSaved,
      isDeployed: jsonState.isDeployed,
      deployedAt: jsonState.deployedAt,
    }

    return await saveWorkflowToNormalizedTables(workflowId, workflowState)
  } catch (error) {
    logger.error(`Error migrating workflow ${workflowId} to normalized tables:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
