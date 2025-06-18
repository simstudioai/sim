import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDBHelpers')

export interface NormalizedWorkflowData {
  blocks: Record<string, any>
  edges: any[]
  loops: Record<string, any>
  parallels: Record<string, any>
  isFromNormalizedTables: true // Flag to indicate this came from new tables
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
      blocksMap[block.id] = {
        id: block.id,
        type: block.type,
        name: block.name,
        position: {
          x: block.positionX,
          y: block.positionY,
        },
        enabled: block.enabled,
        horizontalHandles: block.horizontalHandles,
        isWide: block.isWide,
        height: block.height,
        subBlocks: block.subBlocks || {},
        outputs: block.outputs || {},
        data: block.data || {},
        parentId: (block.data as any)?.parentId || null,
        extent: (block.data as any)?.extent || null,
      }
    })

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

    logger.info(
      `Loaded workflow ${workflowId} from normalized tables: ${blocks.length} blocks, ${edges.length} edges, ${subflows.length} subflows`
    )

    return {
      blocks: blocksMap,
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
 * IMPORTANT: Preserves existing deploy_hash values to maintain deployment state
 */
export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState
): Promise<{ success: boolean; jsonBlob?: any; error?: string }> {
  try {
    // Start a transaction
    const result = await db.transaction(async (tx) => {
      // Get existing deploy_hash values before updating
      const existingBlocks = await tx
        .select({ id: workflowBlocks.id, deployHash: workflowBlocks.deployHash })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, workflowId))

      const existingEdges = await tx
        .select({ id: workflowEdges.id, deployHash: workflowEdges.deployHash })
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, workflowId))

      const existingSubflows = await tx
        .select({ id: workflowSubflows.id, deployHash: workflowSubflows.deployHash })
        .from(workflowSubflows)
        .where(eq(workflowSubflows.workflowId, workflowId))

      // Create maps for quick lookup of existing deploy_hash values
      const blockDeployHashes = new Map(existingBlocks.map(b => [b.id, b.deployHash]))
      const edgeDeployHashes = new Map(existingEdges.map(e => [e.id, e.deployHash]))
      const subflowDeployHashes = new Map(existingSubflows.map(s => [s.id, s.deployHash]))

      // Clear existing data for this workflow
      await Promise.all([
        tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
        tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
        tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
      ])

      // Insert blocks (preserving existing deploy_hash values)
      if (Object.keys(state.blocks).length > 0) {
        const blockInserts = Object.values(state.blocks).map((block) => ({
          id: block.id,
          workflowId: workflowId,
          type: block.type,
          name: block.name || '',
          positionX: Math.round(block.position?.x || 0),
          positionY: Math.round(block.position?.y || 0),
          enabled: block.enabled ?? true,
          horizontalHandles: block.horizontalHandles ?? true,
          isWide: block.isWide ?? false,
          height: block.height || 0,
          subBlocks: block.subBlocks || {},
          outputs: block.outputs || {},
          data: block.data || {},
          parentId: block.data?.parentId || null,
          extent: block.data?.extent || null,
          // PRESERVE existing deploy_hash value if it exists
          deployHash: blockDeployHashes.get(block.id) || null,
        }))

        await tx.insert(workflowBlocks).values(blockInserts)
      }

      // Insert edges (preserving existing deploy_hash values)
      if (state.edges.length > 0) {
        const edgeInserts = state.edges.map((edge) => ({
          id: edge.id,
          workflowId: workflowId,
          sourceBlockId: edge.source,
          targetBlockId: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
          // PRESERVE existing deploy_hash value if it exists
          deployHash: edgeDeployHashes.get(edge.id) || null,
        }))

        await tx.insert(workflowEdges).values(edgeInserts)
      }

      // Insert subflows (loops and parallels) preserving existing deploy_hash values
      const subflowInserts: any[] = []

      // Add loops
      Object.values(state.loops || {}).forEach((loop) => {
        subflowInserts.push({
          id: loop.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.LOOP,
          config: loop,
          // PRESERVE existing deploy_hash value if it exists
          deployHash: subflowDeployHashes.get(loop.id) || null,
        })
      })

      // Add parallels
      Object.values(state.parallels || {}).forEach((parallel) => {
        subflowInserts.push({
          id: parallel.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.PARALLEL,
          config: parallel,
          // PRESERVE existing deploy_hash value if it exists
          deployHash: subflowDeployHashes.get(parallel.id) || null,
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
      deploymentStatuses: state.deploymentStatuses,
      hasActiveSchedule: state.hasActiveSchedule,
      hasActiveWebhook: state.hasActiveWebhook,
    }

    logger.info(`Successfully saved workflow ${workflowId} to normalized tables (preserving deploy_hash values)`)

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
      deploymentStatuses: jsonState.deploymentStatuses || {},
      hasActiveSchedule: jsonState.hasActiveSchedule,
      hasActiveWebhook: jsonState.hasActiveWebhook,
    }

    const result = await saveWorkflowToNormalizedTables(workflowId, workflowState)

    if (result.success) {
      logger.info(`Successfully migrated workflow ${workflowId} to normalized tables`)
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

/**
 * Generate a unique deployment hash
 */
function generateDeploymentHash(): string {
  return `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Tag current workflow state with deployment hash
 * This marks the current state as deployed without duplicating data
 */
export async function tagWorkflowAsDeployed(
  workflowId: string
): Promise<{ success: boolean; deployHash?: string; error?: string }> {
  try {
    // Generate unique deployment hash
    const deployHash = generateDeploymentHash()

    // Start a transaction to tag current state with deployment hash
    const result = await db.transaction(async (tx) => {
      // Tag existing blocks with deployment hash
      await tx
        .update(workflowBlocks)
        .set({ deployHash: deployHash })
        .where(eq(workflowBlocks.workflowId, workflowId))

      // Tag existing edges with deployment hash
      await tx
        .update(workflowEdges)
        .set({ deployHash: deployHash })
        .where(eq(workflowEdges.workflowId, workflowId))

      // Tag existing subflows with deployment hash
      await tx
        .update(workflowSubflows)
        .set({ deployHash: deployHash })
        .where(eq(workflowSubflows.workflowId, workflowId))

      return { success: true, deployHash }
    })

    logger.info(`Successfully tagged workflow ${workflowId} as deployed with hash ${deployHash}`)
    return result
  } catch (error) {
    logger.error(`Error tagging workflow ${workflowId} as deployed:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Load deployed workflow state by deployment hash
 * This reconstructs the exact state that was deployed
 */
export async function loadDeployedWorkflowState(
  workflowId: string,
  deployHash: string
): Promise<{ success: boolean; state?: any; error?: string }> {
  try {
    // Load all components by deployment hash
    const [blocks, edges, subflows] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.deployHash, deployHash)),
      db.select().from(workflowEdges).where(eq(workflowEdges.deployHash, deployHash)),
      db.select().from(workflowSubflows).where(eq(workflowSubflows.deployHash, deployHash)),
    ])

    // Convert blocks to the expected format
    const blocksMap: Record<string, any> = {}
    blocks.forEach((block) => {
      blocksMap[block.id] = {
        id: block.id,
        type: block.type,
        name: block.name,
        position: {
          x: block.positionX,
          y: block.positionY,
        },
        enabled: block.enabled,
        horizontalHandles: block.horizontalHandles,
        isWide: block.isWide,
        height: block.height,
        subBlocks: block.subBlocks || {},
        outputs: block.outputs || {},
        data: block.data || {},
        parentId: (block.data as any)?.parentId || null,
        extent: (block.data as any)?.extent || null,
      }
    })

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
      }
    })

    const deployedState = {
      blocks: blocksMap,
      edges: edgesArray,
      loops,
      parallels,
      lastSaved: Date.now(),
      // Don't include deployment fields in state - managed by database columns
    }

    logger.info(
      `Loaded deployed state for workflow ${workflowId} with hash ${deployHash}: ${Object.keys(blocksMap).length} blocks, ${edgesArray.length} edges, ${Object.keys(loops).length} loops, ${Object.keys(parallels).length} parallels`
    )

    return { success: true, state: deployedState }
  } catch (error) {
    logger.error(`Error loading deployed state for workflow ${workflowId} with hash ${deployHash}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
