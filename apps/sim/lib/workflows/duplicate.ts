import { db } from '@sim/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import type { Variable } from '@/stores/panel/variables/types'
import type { LoopConfig, ParallelConfig } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDuplicateHelper')

interface DuplicateWorkflowOptions {
  sourceWorkflowId: string
  userId: string
  name: string
  description?: string
  color?: string
  workspaceId?: string
  folderId?: string | null
  requestId?: string
}

interface DuplicateWorkflowResult {
  id: string
  name: string
  description: string | null
  color: string
  workspaceId: string
  folderId: string | null
  blocksCount: number
  edgesCount: number
  subflowsCount: number
}

/**
 * Duplicate a workflow with all its blocks, edges, and subflows
 * This is a shared helper used by both the workflow duplicate API and folder duplicate API
 */
export async function duplicateWorkflow(
  options: DuplicateWorkflowOptions
): Promise<DuplicateWorkflowResult> {
  const {
    sourceWorkflowId,
    userId,
    name,
    description,
    color,
    workspaceId,
    folderId,
    requestId = 'unknown',
  } = options

  // Generate new workflow ID
  const newWorkflowId = crypto.randomUUID()
  const now = new Date()

  // Duplicate workflow and all related data in a transaction
  const result = await db.transaction(async (tx) => {
    // First verify the source workflow exists
    const sourceWorkflowRow = await tx
      .select()
      .from(workflow)
      .where(eq(workflow.id, sourceWorkflowId))
      .limit(1)

    if (sourceWorkflowRow.length === 0) {
      throw new Error('Source workflow not found')
    }

    const source = sourceWorkflowRow[0]

    // Check if user has permission to access the source workflow
    let canAccessSource = false

    // Case 1: User owns the workflow
    if (source.userId === userId) {
      canAccessSource = true
    }

    // Case 2: User has admin or write permission in the source workspace
    if (!canAccessSource && source.workspaceId) {
      const userPermission = await getUserEntityPermissions(userId, 'workspace', source.workspaceId)
      if (userPermission === 'admin' || userPermission === 'write') {
        canAccessSource = true
      }
    }

    if (!canAccessSource) {
      throw new Error('Source workflow not found or access denied')
    }

    // Create the new workflow first (required for foreign key constraints)
    await tx.insert(workflow).values({
      id: newWorkflowId,
      userId,
      workspaceId: workspaceId || source.workspaceId,
      folderId: folderId !== undefined ? folderId : source.folderId,
      name,
      description: description || source.description,
      color: color || source.color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      // Duplicate variables with new IDs and new workflowId
      variables: (() => {
        const sourceVars = (source.variables as Record<string, Variable>) || {}
        const remapped: Record<string, Variable> = {}
        for (const [, variable] of Object.entries(sourceVars) as [string, Variable][]) {
          const newVarId = crypto.randomUUID()
          remapped[newVarId] = {
            ...variable,
            id: newVarId,
            workflowId: newWorkflowId,
          }
        }
        return remapped
      })(),
    })

    // Copy all blocks from source workflow with new IDs
    const sourceBlocks = await tx
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, sourceWorkflowId))

    // Create a mapping from old block IDs to new block IDs
    const blockIdMapping = new Map<string, string>()

    if (sourceBlocks.length > 0) {
      // First pass: Create all block ID mappings
      sourceBlocks.forEach((block) => {
        const newBlockId = crypto.randomUUID()
        blockIdMapping.set(block.id, newBlockId)
      })

      // Second pass: Create blocks with updated parent relationships
      const newBlocks = sourceBlocks.map((block) => {
        const newBlockId = blockIdMapping.get(block.id)!

        // Update parent ID to point to the new parent block ID if it exists
        const blockData =
          block.data && typeof block.data === 'object' && !Array.isArray(block.data)
            ? (block.data as any)
            : {}
        let newParentId = blockData.parentId
        if (blockData.parentId && blockIdMapping.has(blockData.parentId)) {
          newParentId = blockIdMapping.get(blockData.parentId)!
        }

        // Update data.parentId and extent if they exist in the data object
        let updatedData = block.data
        let newExtent = blockData.extent
        if (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) {
          const dataObj = block.data as any
          if (dataObj.parentId && typeof dataObj.parentId === 'string') {
            updatedData = { ...dataObj }
            if (blockIdMapping.has(dataObj.parentId)) {
              ;(updatedData as any).parentId = blockIdMapping.get(dataObj.parentId)!
              // Ensure extent is set to 'parent' for child blocks
              ;(updatedData as any).extent = 'parent'
              newExtent = 'parent'
            }
          }
        }

        return {
          ...block,
          id: newBlockId,
          workflowId: newWorkflowId,
          parentId: newParentId,
          extent: newExtent,
          data: updatedData,
          createdAt: now,
          updatedAt: now,
        }
      })

      await tx.insert(workflowBlocks).values(newBlocks)
      logger.info(
        `[${requestId}] Copied ${sourceBlocks.length} blocks with updated parent relationships`
      )
    }

    // Copy all edges from source workflow with updated block references
    const sourceEdges = await tx
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, sourceWorkflowId))

    if (sourceEdges.length > 0) {
      const newEdges = sourceEdges.map((edge) => ({
        ...edge,
        id: crypto.randomUUID(), // Generate new edge ID
        workflowId: newWorkflowId,
        sourceBlockId: blockIdMapping.get(edge.sourceBlockId) || edge.sourceBlockId,
        targetBlockId: blockIdMapping.get(edge.targetBlockId) || edge.targetBlockId,
        createdAt: now,
        updatedAt: now,
      }))

      await tx.insert(workflowEdges).values(newEdges)
      logger.info(`[${requestId}] Copied ${sourceEdges.length} edges with updated block references`)
    }

    // Copy all subflows from source workflow with new IDs and updated block references
    const sourceSubflows = await tx
      .select()
      .from(workflowSubflows)
      .where(eq(workflowSubflows.workflowId, sourceWorkflowId))

    if (sourceSubflows.length > 0) {
      const newSubflows = sourceSubflows
        .map((subflow) => {
          // The subflow ID should match the corresponding block ID
          const newSubflowId = blockIdMapping.get(subflow.id)

          if (!newSubflowId) {
            logger.warn(
              `[${requestId}] Subflow ${subflow.id} (${subflow.type}) has no corresponding block, skipping`
            )
            return null
          }

          logger.info(`[${requestId}] Mapping subflow ${subflow.id} → ${newSubflowId}`, {
            subflowType: subflow.type,
          })

          // Update block references in subflow config
          let updatedConfig: LoopConfig | ParallelConfig = subflow.config as
            | LoopConfig
            | ParallelConfig
          if (subflow.config && typeof subflow.config === 'object') {
            updatedConfig = JSON.parse(JSON.stringify(subflow.config)) as
              | LoopConfig
              | ParallelConfig

            // Update the config ID to match the new subflow ID

            ;(updatedConfig as any).id = newSubflowId

            // Update node references in config if they exist
            if ('nodes' in updatedConfig && Array.isArray(updatedConfig.nodes)) {
              updatedConfig.nodes = updatedConfig.nodes.map(
                (nodeId: string) => blockIdMapping.get(nodeId) || nodeId
              )
            }
          }

          return {
            ...subflow,
            id: newSubflowId, // Use the same ID as the corresponding block
            workflowId: newWorkflowId,
            config: updatedConfig,
            createdAt: now,
            updatedAt: now,
          }
        })
        .filter((subflow): subflow is NonNullable<typeof subflow> => subflow !== null)

      if (newSubflows.length > 0) {
        await tx.insert(workflowSubflows).values(newSubflows)
      }

      logger.info(
        `[${requestId}] Copied ${newSubflows.length}/${sourceSubflows.length} subflows with updated block references and matching IDs`
      )
    }

    // Update the workflow timestamp
    await tx
      .update(workflow)
      .set({
        updatedAt: now,
      })
      .where(eq(workflow.id, newWorkflowId))

    const finalWorkspaceId = workspaceId || source.workspaceId
    if (!finalWorkspaceId) {
      throw new Error('Workspace ID is required')
    }

    return {
      id: newWorkflowId,
      name,
      description: description || source.description,
      color: color || source.color,
      workspaceId: finalWorkspaceId,
      folderId: folderId !== undefined ? folderId : source.folderId,
      blocksCount: sourceBlocks.length,
      edgesCount: sourceEdges.length,
      subflowsCount: sourceSubflows.length,
    }
  })

  return result
}
