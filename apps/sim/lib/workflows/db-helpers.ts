import { db } from '@sim/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDBHelpers')

export interface NormalizedWorkflowData {
  blocks: Record<string, any>
  edges: any[]
  loops: Record<string, any>
  parallels: Record<string, any>
  isFromNormalizedTables: boolean // Flag to indicate source (true = normalized tables, false = deployed state)
}

/**
 * Load deployed workflow state for execution
 * Returns deployed state if available, otherwise throws error
 */
export async function loadDeployedWorkflowState(
  workflowId: string
): Promise<NormalizedWorkflowData> {
  try {
    // First check if workflow is deployed and get deployed state
    const [workflowResult] = await db
      .select({
        isDeployed: workflow.isDeployed,
        deployedState: workflow.deployedState,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowResult) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    if (!workflowResult.isDeployed || !workflowResult.deployedState) {
      throw new Error(`Workflow ${workflowId} is not deployed or has no deployed state`)
    }

    const deployedState = workflowResult.deployedState as any

    // Convert deployed state to normalized format
    return {
      blocks: deployedState.blocks || {},
      edges: deployedState.edges || [],
      loops: deployedState.loops || {},
      parallels: deployedState.parallels || {},
      isFromNormalizedTables: false, // Flag to indicate this came from deployed state
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
    const blocksMap: Record<string, any> = {}
    blocks.forEach((block) => {
      // Get parentId and extent from the database columns (primary source)
      const parentId = block.parentId || null
      const extent = block.extent || null

      // Merge data with parent info for backward compatibility
      const blockData = {
        ...(block.data || {}),
        ...(parentId && { parentId }),
        ...(extent && { extent }),
      }

      blocksMap[block.id] = {
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
        subBlocks: block.subBlocks || {},
        outputs: block.outputs || {},
        data: blockData,
        // Set parentId and extent at the block level for ReactFlow
        parentId,
        extent,
      }
    })

    // Sanitize any invalid custom tools in agent blocks to prevent client crashes
    const { blocks: sanitizedBlocks, warnings } = sanitizeAgentToolsInBlocks(blocksMap)
    if (warnings.length > 0) {
      logger.warn(`Sanitized workflow ${workflowId} tools with ${warnings.length} warning(s)`, {
        warnings,
      })
    }

    // Convert edges to the expected format
    const edgesArray = edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceBlockId,
      target: edge.targetBlockId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }))

    // Convert subflows to loops and parallels
    const loops: Record<string, any> = {}
    const parallels: Record<string, any> = {}

    subflows.forEach((subflow) => {
      const config = subflow.config || {}

      if (subflow.type === SUBFLOW_TYPES.LOOP) {
        loops[subflow.id] = {
          id: subflow.id,
          ...config,
        }
      } else if (subflow.type === SUBFLOW_TYPES.PARALLEL) {
        parallels[subflow.id] = {
          id: subflow.id,
          ...config,
        }
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
 * Also returns the JSON blob for backward compatibility
 */
export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState
): Promise<{ success: boolean; jsonBlob?: any; error?: string }> {
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

      return { success: true }
    })

    // Create JSON blob for backward compatibility
    const jsonBlob = {
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
      lastSaved: Date.now(),
      isDeployed: state.isDeployed,
      deployedAt: state.deployedAt,
      deploymentStatuses: state.deploymentStatuses,
      hasActiveWebhook: state.hasActiveWebhook,
    }

    return {
      success: true,
      jsonBlob,
    }
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
    const workflowState: WorkflowState = {
      blocks: jsonState.blocks || {},
      edges: jsonState.edges || [],
      loops: jsonState.loops || {},
      parallels: jsonState.parallels || {},
      lastSaved: jsonState.lastSaved,
      isDeployed: jsonState.isDeployed,
      deployedAt: jsonState.deployedAt,
      deploymentStatuses: jsonState.deploymentStatuses || {},
      hasActiveWebhook: jsonState.hasActiveWebhook,
    }

    const result = await saveWorkflowToNormalizedTables(workflowId, workflowState)

    if (result.success) {
      return { success: true }
    }
    return { success: false, error: result.error }
  } catch (error) {
    logger.error(`Error migrating workflow ${workflowId} to normalized tables:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
