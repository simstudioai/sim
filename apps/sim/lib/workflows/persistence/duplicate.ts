import { db } from '@sim/db'
import {
  workflow,
  workflowBlocks,
  workflowEdges,
  folder as workflowFolder,
  workflowSubflows,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  FolderLockedError,
} from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, min } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { remapConditionEdgeHandle } from '@/lib/workflows/condition-ids'
import {
  remapConditionIdsInSubBlocks,
  remapVariableIdsInSubBlocks,
  remapWorkflowReferencesInSubBlocks,
  type SubBlockRecord,
  sanitizeSubBlocksForDuplicate,
} from '@/lib/workflows/persistence/remap-internal-ids'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import type { Variable } from '@/stores/variables/types'
import type { LoopConfig, ParallelConfig } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDuplicateHelper')

interface DuplicateWorkflowOptions {
  sourceWorkflowId: string
  userId: string
  name: string
  description?: string
  workspaceId?: string
  folderId?: string | null
  requestId?: string
  newWorkflowId?: string
  /**
   * Run inside the caller's transaction. Callers that pass `tx` must have
   * already authorized the user on the source workflow's workspace: the
   * authorization helpers query through the global pool, so running them here
   * would require a second pooled connection while the caller's transaction
   * holds the first.
   */
  tx?: DbOrTx
  workflowIdMap?: Map<string, string>
}

interface DuplicateWorkflowResult {
  id: string
  name: string
  description: string | null
  workspaceId: string
  folderId: string | null
  sortOrder: number
  locked: boolean
  blocksCount: number
  edgesCount: number
  subflowsCount: number
}

async function assertTargetFolderMutable(
  tx: DbOrTx,
  folderId: string | null,
  targetWorkspaceId: string
): Promise<void> {
  let currentFolderId = folderId
  const visited = new Set<string>()

  while (currentFolderId && !visited.has(currentFolderId)) {
    visited.add(currentFolderId)
    const [folder] = await tx
      .select({
        id: workflowFolder.id,
        parentId: workflowFolder.parentId,
        workspaceId: workflowFolder.workspaceId,
        locked: workflowFolder.locked,
        archivedAt: workflowFolder.deletedAt,
      })
      .from(workflowFolder)
      .where(eq(workflowFolder.id, currentFolderId))
      .limit(1)

    if (!folder || folder.workspaceId !== targetWorkspaceId || folder.archivedAt) {
      throw new Error('Target folder not found')
    }
    if (folder.locked) {
      throw new FolderLockedError()
    }
    currentFolderId = folder.parentId
  }
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
    workspaceId,
    folderId,
    requestId = 'unknown',
    newWorkflowId: clientNewWorkflowId,
    tx: providedTx,
    workflowIdMap,
  } = options

  const newWorkflowId = clientNewWorkflowId || workflowIdMap?.get(sourceWorkflowId) || generateId()
  const now = new Date()

  // Authorization runs before the transaction opens so its global-pool
  // queries never execute while a pooled connection is held. Callers that
  // pass `tx` authorize the workspace themselves (see DuplicateWorkflowOptions).
  if (!providedTx) {
    const sourceAuthorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: sourceWorkflowId,
      userId,
      action: 'read',
    })
    if (!sourceAuthorization.allowed || !sourceAuthorization.workflow) {
      throw new Error('Source workflow not found or access denied')
    }

    const sourceWorkspaceId = sourceAuthorization.workflow.workspaceId
    if (!sourceWorkspaceId) {
      throw new Error(
        'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be duplicated.'
      )
    }

    const targetWorkspaceId = workspaceId || sourceWorkspaceId
    if (targetWorkspaceId !== sourceWorkspaceId) {
      throw new Error('Cross-workspace workflow duplication is not supported')
    }

    // The target workspace equals the source workspace, so the permission
    // resolved by the authorization above is the target permission.
    if (
      sourceAuthorization.workspacePermission !== 'admin' &&
      sourceAuthorization.workspacePermission !== 'write'
    ) {
      throw new Error('Write or admin access required for target workspace')
    }
  }

  const duplicateWithinTransaction = async (tx: DbOrTx) => {
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
    if (!source.workspaceId) {
      throw new Error(
        'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be duplicated.'
      )
    }

    const targetWorkspaceId = workspaceId || source.workspaceId
    if (targetWorkspaceId !== source.workspaceId) {
      throw new Error('Cross-workspace workflow duplication is not supported')
    }

    const targetFolderId = folderId !== undefined ? folderId : source.folderId
    await assertTargetFolderMutable(tx, targetFolderId, targetWorkspaceId)

    const workflowParentCondition = targetFolderId
      ? eq(workflow.folderId, targetFolderId)
      : isNull(workflow.folderId)
    const folderParentCondition = targetFolderId
      ? eq(workflowFolder.parentId, targetFolderId)
      : isNull(workflowFolder.parentId)

    const [[workflowMinResult], [folderMinResult]] = await Promise.all([
      tx
        .select({ minOrder: min(workflow.sortOrder) })
        .from(workflow)
        .where(and(eq(workflow.workspaceId, targetWorkspaceId), workflowParentCondition)),
      tx
        .select({ minOrder: min(workflowFolder.sortOrder) })
        .from(workflowFolder)
        .where(
          and(
            eq(workflowFolder.workspaceId, targetWorkspaceId),
            eq(workflowFolder.resourceType, 'workflow'),
            folderParentCondition
          )
        ),
    ])
    const minSortOrder = [workflowMinResult?.minOrder, folderMinResult?.minOrder].reduce<
      number | null
    >((currentMin, candidate) => {
      if (candidate == null) return currentMin
      if (currentMin == null) return candidate
      return Math.min(currentMin, candidate)
    }, null)
    const sortOrder = minSortOrder != null ? minSortOrder - 1 : 0

    // Mapping from old variable IDs to new variable IDs (populated during variable duplication)
    const varIdMapping = new Map<string, string>()

    const deduplicatedName = await deduplicateWorkflowName(
      name,
      targetWorkspaceId,
      targetFolderId,
      tx
    )

    await tx.insert(workflow).values({
      id: newWorkflowId,
      userId,
      workspaceId: targetWorkspaceId,
      folderId: targetFolderId,
      sortOrder,
      name: deduplicatedName,
      description: description || source.description,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      locked: false,
      // Duplicate variables with new IDs and new workflowId
      variables: (() => {
        const sourceVars = (source.variables as Record<string, Variable>) || {}
        const remapped: Record<string, Variable> = {}
        for (const [oldVarId, variable] of Object.entries(sourceVars) as [string, Variable][]) {
          const newVarId = generateId()
          varIdMapping.set(oldVarId, newVarId)
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
        const newBlockId = generateId()
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

        // Update variable references in subBlocks (e.g. variables-input assignments)
        let updatedSubBlocks = block.subBlocks
        if (
          updatedSubBlocks &&
          typeof updatedSubBlocks === 'object' &&
          !Array.isArray(updatedSubBlocks)
        ) {
          updatedSubBlocks = sanitizeSubBlocksForDuplicate(updatedSubBlocks as SubBlockRecord)
        }
        if (
          varIdMapping.size > 0 &&
          updatedSubBlocks &&
          typeof updatedSubBlocks === 'object' &&
          !Array.isArray(updatedSubBlocks)
        ) {
          updatedSubBlocks = remapVariableIdsInSubBlocks(
            updatedSubBlocks as SubBlockRecord,
            varIdMapping
          )
        }
        if (
          updatedSubBlocks &&
          typeof updatedSubBlocks === 'object' &&
          !Array.isArray(updatedSubBlocks)
        ) {
          updatedSubBlocks = remapWorkflowReferencesInSubBlocks(
            updatedSubBlocks as SubBlockRecord,
            workflowIdMap
          )
        }

        // Remap condition/router IDs to use the new block ID
        if (updatedSubBlocks && typeof updatedSubBlocks === 'object') {
          updatedSubBlocks = remapConditionIdsInSubBlocks(
            updatedSubBlocks as Record<string, any>,
            block.id,
            newBlockId
          )
        }

        return {
          ...block,
          id: newBlockId,
          workflowId: newWorkflowId,
          parentId: newParentId,
          extent: newExtent,
          data: updatedData,
          subBlocks: updatedSubBlocks,
          locked: false, // Duplicated blocks should always be unlocked
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
      /**
       * Edge remap is best-effort: when an edge points at a source/target block
       * that isn't in `blockIdMapping`, we drop the edge with a `logger.warn`
       * instead of throwing. This matches the pre-PR leniency (which silently
       * kept stale references) and avoids rolling back an entire folder-tree
       * duplicate transaction over a single orphaned reference. Inserting an
       * edge with a stale block id would create a dangling DB row, so we skip
       * the edge entirely rather than carry forward the unmapped id.
       */
      const newEdges = sourceEdges.flatMap((edge) => {
        const newSourceBlockId = blockIdMapping.get(edge.sourceBlockId)
        const newTargetBlockId = blockIdMapping.get(edge.targetBlockId)
        if (!newSourceBlockId || !newTargetBlockId) {
          logger.warn('Skipping edge with unmapped block reference during duplication', {
            requestId,
            edgeId: edge.id,
            sourceBlockId: edge.sourceBlockId,
            targetBlockId: edge.targetBlockId,
          })
          return []
        }
        const newSourceHandle =
          edge.sourceHandle && blockIdMapping.has(edge.sourceBlockId)
            ? remapConditionEdgeHandle(edge.sourceHandle, edge.sourceBlockId, newSourceBlockId)
            : edge.sourceHandle

        return [
          {
            ...edge,
            id: generateId(),
            workflowId: newWorkflowId,
            sourceBlockId: newSourceBlockId,
            targetBlockId: newTargetBlockId,
            sourceHandle: newSourceHandle,
            createdAt: now,
            updatedAt: now,
          },
        ]
      })

      if (newEdges.length > 0) {
        await tx.insert(workflowEdges).values(newEdges)
      }
      logger.info(
        `[${requestId}] Copied ${newEdges.length}/${sourceEdges.length} edges with updated block references`
      )
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
            updatedConfig = structuredClone(subflow.config) as LoopConfig | ParallelConfig

            // Update the config ID to match the new subflow ID

            ;(updatedConfig as any).id = newSubflowId

            /**
             * Subflow node remap is best-effort: when `config.nodes` lists a
             * block id that isn't in `blockIdMapping`, we drop the entry with
             * a `logger.warn` instead of throwing. This matches the pre-PR
             * leniency (which silently carried the stale id forward) and
             * avoids rolling back an entire folder-tree duplicate transaction
             * over a single orphaned reference. Downstream consumers and
             * cleanup tolerate missing membership entries the same way they
             * tolerate other persisted drift.
             */
            if ('nodes' in updatedConfig && Array.isArray(updatedConfig.nodes)) {
              updatedConfig.nodes = updatedConfig.nodes.flatMap((nodeId: string) => {
                const newNodeId = blockIdMapping.get(nodeId)
                if (!newNodeId) {
                  logger.warn('Skipping unmapped subflow node reference during duplication', {
                    requestId,
                    subflowId: subflow.id,
                    nodeId,
                  })
                  return []
                }
                return [newNodeId]
              })
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
      name: deduplicatedName,
      description: description || source.description,
      workspaceId: finalWorkspaceId,
      folderId: targetFolderId,
      sortOrder,
      locked: false,
      blocksCount: sourceBlocks.length,
      edgesCount: sourceEdges.length,
      subflowsCount: sourceSubflows.length,
    }
  }

  const result = providedTx
    ? await duplicateWithinTransaction(providedTx)
    : await db.transaction(duplicateWithinTransaction)

  return result
}
