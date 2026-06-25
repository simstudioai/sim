import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { remapConditionEdgeHandle } from '@/lib/workflows/condition-ids'
import {
  remapConditionIdsInSubBlocks,
  remapVariableIdsInSubBlocks,
  remapWorkflowReferencesInSubBlocks,
  type SubBlockRecord,
  sanitizeSubBlocksForDuplicate,
} from '@/lib/workflows/persistence/remap-internal-ids'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deriveForkBlockId } from '@/lib/workspaces/fork/remap/block-identity'
import type {
  BlockData,
  BlockState,
  Loop,
  Parallel,
  SubBlockState,
  WorkflowState,
  Variable as WorkflowStateVariable,
} from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkspaceForkCopyWorkflows')

type SubBlockTransform = (subBlocks: SubBlockRecord) => SubBlockRecord

interface ResolveForkFolderMappingParams {
  tx: DbOrTx
  sourceWorkspaceId: string
  targetWorkspaceId: string
  userId: string
  now: Date
}

/**
 * Mirror the source workspace's folder tree into the target workspace, creating
 * folders as needed and reusing target folders that already match by name within
 * the same (mapped) parent. Returns a map from source folder id to target folder
 * id so copied workflows can be placed in the corresponding folder.
 */
export async function resolveForkFolderMapping({
  tx,
  sourceWorkspaceId,
  targetWorkspaceId,
  userId,
  now,
}: ResolveForkFolderMappingParams): Promise<Map<string, string>> {
  const map = new Map<string, string>()

  const sourceFolders = await tx
    .select()
    .from(workflowFolder)
    .where(
      and(eq(workflowFolder.workspaceId, sourceWorkspaceId), isNull(workflowFolder.archivedAt))
    )

  if (sourceFolders.length === 0) return map

  const targetFolders = await tx
    .select()
    .from(workflowFolder)
    .where(
      and(eq(workflowFolder.workspaceId, targetWorkspaceId), isNull(workflowFolder.archivedAt))
    )

  const targetByKey = new Map<string, string>()
  for (const folder of targetFolders) {
    targetByKey.set(`${folder.parentId ?? ''}::${folder.name}`, folder.id)
  }

  const byId = new Map(sourceFolders.map((folder) => [folder.id, folder]))
  const ordered: typeof sourceFolders = []
  const seen = new Set<string>()
  const visit = (folder: (typeof sourceFolders)[number]) => {
    if (seen.has(folder.id)) return
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined
    if (parent) visit(parent)
    seen.add(folder.id)
    ordered.push(folder)
  }
  for (const folder of sourceFolders) visit(folder)

  const newFolders: (typeof sourceFolders)[number][] = []
  for (const folder of ordered) {
    const mappedParentId = folder.parentId ? (map.get(folder.parentId) ?? null) : null
    const key = `${mappedParentId ?? ''}::${folder.name}`
    const existing = targetByKey.get(key)
    if (existing) {
      map.set(folder.id, existing)
      continue
    }
    const newFolderId = generateId()
    map.set(folder.id, newFolderId)
    targetByKey.set(key, newFolderId)
    newFolders.push({
      ...folder,
      id: newFolderId,
      userId,
      workspaceId: targetWorkspaceId,
      parentId: mappedParentId,
      locked: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  if (newFolders.length > 0) {
    await tx.insert(workflowFolder).values(newFolders)
  }

  return map
}

async function resolveTargetWorkflowName(
  tx: DbOrTx,
  workspaceId: string,
  folderId: string | null,
  name: string,
  excludeWorkflowId: string | null
): Promise<string> {
  const folderCondition = folderId ? eq(workflow.folderId, folderId) : isNull(workflow.folderId)

  const nameTaken = async (candidate: string): Promise<boolean> => {
    const conditions = [
      eq(workflow.workspaceId, workspaceId),
      folderCondition,
      eq(workflow.name, candidate),
      isNull(workflow.archivedAt),
    ]
    if (excludeWorkflowId) conditions.push(ne(workflow.id, excludeWorkflowId))
    const [row] = await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(...conditions))
      .limit(1)
    return Boolean(row)
  }

  if (!(await nameTaken(name))) return name
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`
    if (!(await nameTaken(candidate))) return candidate
  }
  return `${name} (${generateId().slice(0, 6)})`
}

export interface CopyWorkflowResult {
  targetWorkflowId: string
  mode: 'create' | 'replace'
  name: string
  blocksCount: number
  edgesCount: number
  subflowsCount: number
}

export interface CopyWorkflowStateParams {
  tx: DbOrTx
  targetWorkflowId: string
  targetWorkspaceId: string
  userId: string
  mode: 'create' | 'replace'
  now: Date
  /** Source workflow's deployed state (the only thing fork/promote copies). */
  sourceState: WorkflowState
  /** Source workflow metadata for naming, folder placement, and sort order. */
  sourceMeta: {
    name: string
    description: string | null
    folderId: string | null
    sortOrder: number
  }
  /** source workflow id -> target workflow id, for `workflow-selector` references */
  workflowIdMap: Map<string, string>
  /** source folder id -> target folder id */
  folderIdMap: Map<string, string>
  /** Optional resource-reference remap applied to every block's subBlocks. */
  transformSubBlocks?: SubBlockTransform
  requestId?: string
}

/**
 * Copy a source workflow's deployed `WorkflowState` into a target workflow,
 * assigning deterministic block ids (so trigger webhook URLs and external block
 * references stay stable across promotes) and applying the resource-reference
 * transform. Writes the remapped state to the target's draft via
 * `saveWorkflowToNormalizedTables`. In `create` mode a new workflow row is
 * inserted (undeployed); in `replace` mode the existing target row is kept and
 * its draft is overwritten. Deploying the target (and capturing the rollback
 * point) is the caller's responsibility.
 */
export async function copyWorkflowStateIntoTarget(
  params: CopyWorkflowStateParams
): Promise<CopyWorkflowResult> {
  const {
    tx,
    targetWorkflowId,
    targetWorkspaceId,
    userId,
    mode,
    now,
    sourceState,
    sourceMeta,
    workflowIdMap,
    folderIdMap,
    transformSubBlocks,
    requestId = 'unknown',
  } = params

  const targetFolderId = sourceMeta.folderId ? (folderIdMap.get(sourceMeta.folderId) ?? null) : null

  const varIdMapping = new Map<string, string>()
  const remappedVariables: Record<string, WorkflowStateVariable> = {}
  for (const [oldVarId, variable] of Object.entries(sourceState.variables ?? {})) {
    const newVarId = generateId()
    varIdMapping.set(oldVarId, newVarId)
    remappedVariables[newVarId] = { ...variable, id: newVarId }
  }

  const blockIdMapping = new Map<string, string>()
  for (const oldBlockId of Object.keys(sourceState.blocks)) {
    blockIdMapping.set(oldBlockId, deriveForkBlockId(targetWorkflowId, oldBlockId))
  }

  const newBlocks: Record<string, BlockState> = {}
  for (const [oldBlockId, block] of Object.entries(sourceState.blocks)) {
    const newBlockId = blockIdMapping.get(oldBlockId)!

    let updatedData = block.data
    if (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) {
      const dataObj = block.data as Record<string, unknown>
      if (typeof dataObj.parentId === 'string' && blockIdMapping.has(dataObj.parentId)) {
        updatedData = {
          ...dataObj,
          parentId: blockIdMapping.get(dataObj.parentId)!,
          extent: 'parent',
        } as BlockData
      }
    }

    // double-cast-allowed: SubBlockState is structurally a SubBlockRecord entry but lacks the open index signature SubBlockRecord declares
    let subBlocks: SubBlockRecord = sanitizeSubBlocksForDuplicate(
      (block.subBlocks ?? {}) as unknown as SubBlockRecord
    )
    if (transformSubBlocks) {
      subBlocks = transformSubBlocks(subBlocks)
    }
    if (varIdMapping.size > 0) {
      subBlocks = remapVariableIdsInSubBlocks(subBlocks, varIdMapping)
    }
    // Cross-workspace copy: clear references to workflows that weren't copied
    // rather than leave them pointing at the source workspace.
    subBlocks = remapWorkflowReferencesInSubBlocks(subBlocks, workflowIdMap, {
      clearUnmapped: true,
    })
    subBlocks = remapConditionIdsInSubBlocks(subBlocks, oldBlockId, newBlockId) as SubBlockRecord

    newBlocks[newBlockId] = {
      ...block,
      id: newBlockId,
      // double-cast-allowed: remap helpers return SubBlockRecord; the entries retain the SubBlockState shape this block requires
      subBlocks: subBlocks as unknown as Record<string, SubBlockState>,
      data: updatedData,
    }
  }

  const newEdges = sourceState.edges.flatMap((edge) => {
    const newSource = blockIdMapping.get(edge.source)
    const newTarget = blockIdMapping.get(edge.target)
    if (!newSource || !newTarget) {
      logger.warn(`[${requestId}] Skipping edge with unmapped block reference during fork copy`, {
        edgeId: edge.id,
      })
      return []
    }
    const newSourceHandle = edge.sourceHandle
      ? remapConditionEdgeHandle(edge.sourceHandle, edge.source, newSource)
      : edge.sourceHandle
    return [
      {
        ...edge,
        id: generateId(),
        source: newSource,
        target: newTarget,
        sourceHandle: newSourceHandle,
        targetHandle: edge.targetHandle,
      },
    ]
  })

  const newLoops: Record<string, Loop> = {}
  for (const [oldId, loop] of Object.entries(sourceState.loops ?? {})) {
    const newId = blockIdMapping.get(oldId) ?? oldId
    newLoops[newId] = {
      ...loop,
      id: newId,
      nodes: loop.nodes.flatMap((nodeId) => {
        const mapped = blockIdMapping.get(nodeId)
        return mapped ? [mapped] : []
      }),
    }
  }

  const newParallels: Record<string, Parallel> = {}
  for (const [oldId, parallel] of Object.entries(sourceState.parallels ?? {})) {
    const newId = blockIdMapping.get(oldId) ?? oldId
    newParallels[newId] = {
      ...parallel,
      id: newId,
      nodes: parallel.nodes.flatMap((nodeId) => {
        const mapped = blockIdMapping.get(nodeId)
        return mapped ? [mapped] : []
      }),
    }
  }

  const resolvedName = await resolveTargetWorkflowName(
    tx,
    targetWorkspaceId,
    targetFolderId,
    sourceMeta.name,
    mode === 'replace' ? targetWorkflowId : null
  )

  if (mode === 'create') {
    await tx.insert(workflow).values({
      id: targetWorkflowId,
      userId,
      workspaceId: targetWorkspaceId,
      folderId: targetFolderId,
      sortOrder: sourceMeta.sortOrder,
      name: resolvedName,
      description: sourceMeta.description,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      locked: false,
      variables: remappedVariables,
    })
  } else {
    await tx
      .update(workflow)
      .set({
        name: resolvedName,
        description: sourceMeta.description,
        folderId: targetFolderId,
        variables: remappedVariables,
        lastSynced: now,
        updatedAt: now,
      })
      .where(eq(workflow.id, targetWorkflowId))
  }

  const remappedState: WorkflowState = {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    variables: remappedVariables,
  }
  const saved = await saveWorkflowToNormalizedTables(targetWorkflowId, remappedState, tx)
  if (!saved.success) {
    throw new Error(`Failed to write forked workflow ${targetWorkflowId}: ${saved.error}`)
  }

  return {
    targetWorkflowId,
    mode,
    name: resolvedName,
    blocksCount: Object.keys(newBlocks).length,
    edgesCount: newEdges.length,
    subflowsCount: Object.keys(newLoops).length + Object.keys(newParallels).length,
  }
}
