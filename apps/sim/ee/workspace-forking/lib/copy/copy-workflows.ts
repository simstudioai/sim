import { workflow, workflowBlocks, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import {
  deriveForkBlockId,
  type ForkBlockIdResolver,
} from '@/ee/workspace-forking/lib/remap/block-identity'
import {
  applyDependentOverrides,
  collectClearedDependents,
  type NeedsConfigurationField,
  type SubBlockTransform,
} from '@/ee/workspace-forking/lib/remap/remap-references'
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

interface ResolveForkFolderMappingParams {
  tx: DbOrTx
  sourceWorkspaceId: string
  targetWorkspaceId: string
  userId: string
  now: Date
  /**
   * Source folder ids that will directly hold copied content (workflows); null entries
   * (root-placed content) are ignored. A source folder is copied into the target only when
   * its subtree contains at least one of these, so a fork/sync never creates folders that
   * would end up empty. Copied workspace FILES never influence this set: they live in the
   * separate `workspace_file_folders` entity and are flattened to root by the copy.
   */
  contentFolderIds: ReadonlyArray<string | null>
}

/**
 * Mirror into the target workspace the part of the source folder tree that will actually
 * receive copied content: the folders in `contentFolderIds` plus their ancestor chains (so
 * nesting stays intact). Target folders that already match by name within the same (mapped)
 * parent are reused instead of duplicated. Folders whose subtree holds no copied content are
 * pruned - never created - though a pruned folder still maps onto an existing target folder
 * when one matches, so previously-synced content refs keep resolving. Returns a map from
 * source folder id to target folder id; a copied workflow whose folder is absent from the
 * map is placed at the target's root (see {@link copyWorkflowStateIntoTarget}).
 */
export async function resolveForkFolderMapping({
  tx,
  sourceWorkspaceId,
  targetWorkspaceId,
  userId,
  now,
  contentFolderIds,
}: ResolveForkFolderMappingParams): Promise<Map<string, string>> {
  const map = new Map<string, string>()

  const sourceFolders = await tx
    .select()
    .from(workflowFolder)
    .where(
      and(eq(workflowFolder.workspaceId, sourceWorkspaceId), isNull(workflowFolder.archivedAt))
    )

  if (sourceFolders.length === 0) return map

  const byId = new Map(sourceFolders.map((folder) => [folder.id, folder]))

  // Kept = folders that directly hold copied content plus every ancestor; everything else
  // would be empty in the target and is pruned. A dangling (archived) parent ends the walk,
  // matching the re-root fallback below.
  const kept = new Set<string>()
  for (const folderId of contentFolderIds) {
    let current = folderId ? byId.get(folderId) : undefined
    while (current && !kept.has(current.id)) {
      kept.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }

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
    const isKept = kept.has(folder.id)
    const mappedParentId = folder.parentId ? (map.get(folder.parentId) ?? null) : null
    const key = `${mappedParentId ?? ''}::${folder.name}`
    const existing = targetByKey.get(key)
    if (existing) {
      // A pruned folder may still MAP onto an existing target folder, but only when its
      // parent chain actually resolved: an unmapped pruned parent aliases the key to root
      // level, which could match an unrelated same-named root folder.
      if (isKept || !folder.parentId || map.has(folder.parentId)) {
        map.set(folder.id, existing)
      }
      continue
    }
    if (!isKept) continue
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

// `\u0000` (a NUL byte) can never appear in a Postgres text column, so it is a
// collision-free separator between the folder id and the name.
const workflowNameKey = (folderId: string | null, name: string) => `${folderId ?? ''}\u0000${name}`

/**
 * In-memory registry of a workspace's active workflow names, keyed by
 * (folderId, name) - the exact columns of the `workflow_workspace_folder_name_active_unique`
 * partial index. Lets fork/promote resolve name collisions across many copied workflows
 * from a single load instead of one `nameTaken` query per workflow inside the (locked)
 * transaction.
 *
 * Correctness is still guaranteed by that DB unique index; this is only a proactive
 * collision avoider. A stale snapshot (e.g. a concurrent non-fork rename mid-promote) can
 * therefore only cause a rare, retry-able unique violation - never a duplicate name -
 * exactly as the prior per-workflow check-then-write already could.
 */
export interface WorkflowNameRegistry {
  /** True when (folderId, name) is held by any active workflow other than `excludeWorkflowId`. */
  isTaken(folderId: string | null, name: string, excludeWorkflowId: string | null): boolean
  /** Record that `workflowId` now holds (folderId, name), releasing any name it held before. */
  claim(folderId: string | null, name: string, workflowId: string): void
}

/** Build a {@link WorkflowNameRegistry} from already-loaded rows (pure - unit-testable). */
export function buildWorkflowNameRegistry(
  rows: Array<{ id: string; folderId: string | null; name: string }>
): WorkflowNameRegistry {
  const holdersByKey = new Map<string, Set<string>>()
  const keyByWorkflow = new Map<string, string>()
  for (const row of rows) {
    const key = workflowNameKey(row.folderId, row.name)
    const holders = holdersByKey.get(key)
    if (holders) holders.add(row.id)
    else holdersByKey.set(key, new Set([row.id]))
    keyByWorkflow.set(row.id, key)
  }

  return {
    isTaken(folderId, name, excludeWorkflowId) {
      const holders = holdersByKey.get(workflowNameKey(folderId, name))
      if (!holders) return false
      for (const id of holders) if (id !== excludeWorkflowId) return true
      return false
    },
    claim(folderId, name, workflowId) {
      const newKey = workflowNameKey(folderId, name)
      const prevKey = keyByWorkflow.get(workflowId)
      if (prevKey === newKey) return
      if (prevKey) holdersByKey.get(prevKey)?.delete(workflowId)
      const holders = holdersByKey.get(newKey)
      if (holders) holders.add(workflowId)
      else holdersByKey.set(newKey, new Set([workflowId]))
      keyByWorkflow.set(workflowId, newKey)
    },
  }
}

/** Load every active workflow name in a workspace into a {@link WorkflowNameRegistry}. */
export async function loadWorkflowNameRegistry(
  executor: DbOrTx,
  workspaceId: string
): Promise<WorkflowNameRegistry> {
  const rows = await executor
    .select({ id: workflow.id, folderId: workflow.folderId, name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
  return buildWorkflowNameRegistry(rows)
}

/**
 * Batched read of the current DRAFT subBlocks for a set of (replace) target
 * workflows, keyed `workflowId -> blockId -> subBlocks`. One query for the whole
 * promote so the locked apply phase doesn't do N per-workflow loads; called
 * pre-write so it reflects the target state the user configured before this sync
 * overwrites it. Promote uses it to detect required dependents the sync left empty
 * (see {@link collectClearedDependents}); fork-create has no prior target and skips it.
 */
export async function loadTargetDraftSubBlocks(
  executor: DbOrTx,
  workflowIds: string[]
): Promise<Map<string, Map<string, SubBlockRecord>>> {
  const byWorkflow = new Map<string, Map<string, SubBlockRecord>>()
  if (workflowIds.length === 0) return byWorkflow
  const rows = await executor
    .select({
      workflowId: workflowBlocks.workflowId,
      blockId: workflowBlocks.id,
      subBlocks: workflowBlocks.subBlocks,
    })
    .from(workflowBlocks)
    .where(inArray(workflowBlocks.workflowId, workflowIds))
  for (const row of rows) {
    let blocks = byWorkflow.get(row.workflowId)
    if (!blocks) {
      blocks = new Map<string, SubBlockRecord>()
      byWorkflow.set(row.workflowId, blocks)
    }
    blocks.set(row.blockId, (row.subBlocks ?? {}) as SubBlockRecord)
  }
  return byWorkflow
}

/**
 * Pick a non-colliding name for a copied workflow against the preloaded registry, which
 * mirrors the workspace's (folder, name, not-archived, exclude-self) predicate from one
 * query instead of one per candidate. Mirrors {@link deduplicateWorkflowName}'s ` (n)`
 * numbering, but reads from memory so the copy loop issues no per-workflow name queries.
 */
function resolveTargetWorkflowName(
  registry: WorkflowNameRegistry,
  folderId: string | null,
  name: string,
  excludeWorkflowId: string | null
): string {
  const taken = (candidate: string) => registry.isTaken(folderId, candidate, excludeWorkflowId)
  if (!taken(name)) return name
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`
    if (!taken(candidate)) return candidate
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
  /**
   * `dependsOn` fields (top-level and nested tool-input) a remapped parent left empty
   * that weren't restored from the target draft - the parent legitimately changed.
   * Carries `required` per field: promote skips redeploy + gates on required ones and
   * surfaces optional ones so a cleared filter never broadens behavior silently.
   */
  clearedDependents: NeedsConfigurationField[]
  /**
   * Source block id -> assigned target block id, so the caller can persist the
   * block-identity pairs (see `recordForkBlockPairs`) that keep promotes reversible.
   */
  blockIdMapping: Map<string, string>
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
    /**
     * Whether the source's deployed API is public (unauthenticated). Carried onto sync targets
     * so a public source stays public after push/pull - the target org's own access-control
     * gate (`validatePublicApiAllowed`) still applies at execution. Omitted at fork-create:
     * the child starts undeployed and private (going public is an explicit act there).
     */
    isPublicApi?: boolean
  }
  /** source workflow id -> target workflow id, for `workflow-selector` references */
  workflowIdMap: Map<string, string>
  /** source folder id -> target folder id */
  folderIdMap: Map<string, string>
  /** Optional resource-reference remap applied to every block's subBlocks. */
  transformSubBlocks?: SubBlockTransform
  /**
   * The target workflow's current draft subBlocks (block id -> subBlocks), for
   * `replace` mode only. When present, required dependents that the sync left empty
   * (the parent change cleared and the stored mapping didn't fill) are reported in
   * {@link CopyWorkflowResult.needsConfiguration}.
   */
  targetCurrentBlocks?: Map<string, SubBlockRecord>
  /**
   * Per-block (block id -> subBlock key -> value) stored dependent values applied last,
   * after the reference transform cleared the source's, so the stored mapping is the sole
   * source of truth for what each dependent selector resolves to.
   */
  dependentOverrides?: Map<string, Map<string, string>>
  /**
   * Preloaded name registry so name-collision resolution reads from memory instead of one
   * query per workflow inside the tx. Build once per copy loop via {@link loadWorkflowNameRegistry}.
   */
  nameRegistry: WorkflowNameRegistry
  /**
   * Resolve each source block to its target block id, reusing the persisted counterpart
   * when one exists so a push keeps the parent's original block ids (and webhook URLs)
   * instead of re-deriving them (see {@link buildForkBlockIdResolver}). Omitted on fork
   * creation, where every id is derived fresh.
   */
  resolveBlockId?: ForkBlockIdResolver
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
    targetCurrentBlocks,
    dependentOverrides,
    nameRegistry,
    resolveBlockId,
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
    blockIdMapping.set(
      oldBlockId,
      resolveBlockId
        ? resolveBlockId(targetWorkflowId, oldBlockId)
        : deriveForkBlockId(targetWorkflowId, oldBlockId)
    )
  }

  const newBlocks: Record<string, BlockState> = {}
  const clearedDependents: NeedsConfigurationField[] = []
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
    const sourceSubBlocks = (block.subBlocks ?? {}) as unknown as SubBlockRecord
    const sanitizedSource = sanitizeSubBlocksForDuplicate(sourceSubBlocks)
    let subBlocks: SubBlockRecord = sanitizedSource
    // Tracks the block's live `canonicalModes` through this pass, so a `tool-input` reindex
    // (a dropped custom-tool/MCP entry shifts later tools' array positions) is visible to every
    // later step below that resolves a nested tool's basic/advanced mode - not just the final
    // persisted `updatedData`. Starts as the source value; `transformSubBlocks` may replace it.
    let activeCanonicalModes: CanonicalModeOverrides | undefined = (
      block.data as { canonicalModes?: Record<string, 'basic' | 'advanced'> } | undefined
    )?.canonicalModes
    if (transformSubBlocks) {
      subBlocks = transformSubBlocks(subBlocks, block.type, activeCanonicalModes, (next) => {
        activeCanonicalModes = next
        updatedData = { ...updatedData, canonicalModes: next } as BlockData
      })
    }
    if (varIdMapping.size > 0) {
      subBlocks = remapVariableIdsInSubBlocks(subBlocks, varIdMapping)
    }
    // Cross-workspace copy: clear references to workflows that weren't copied
    // rather than leave them pointing at the source workspace.
    subBlocks = remapWorkflowReferencesInSubBlocks(subBlocks, workflowIdMap, {
      clearUnmapped: true,
      canonicalModes: activeCanonicalModes,
    })
    subBlocks = remapConditionIdsInSubBlocks(subBlocks, oldBlockId, newBlockId) as SubBlockRecord

    // Apply the stored dependent values for this block (the modal's mapping). The reference
    // transform already cleared the source's dependent values when their parent was remapped,
    // so the stored mapping is the SOLE source of truth - no implicit "preserve the target's
    // value" path. Allowlisted (top-level + nested tool params) inside applyDependentOverrides
    // so a crafted value can't touch a parent/credential field or inject a bogus subblock.
    const targetCurrent = targetCurrentBlocks?.get(newBlockId)
    const blockOverrides = dependentOverrides?.get(newBlockId)
    if (blockOverrides && blockOverrides.size > 0) {
      subBlocks = applyDependentOverrides(subBlocks, block.type, blockOverrides)
    }

    // Dependents the TARGET had configured that the parent change cleared and nothing
    // restored: the target must re-pick required ones (promote skips this workflow's
    // redeploy) and is told about optional ones. Keyed on the target draft so a field the
    // source carried but the target never set isn't flagged.
    if (mode === 'replace' && targetCurrent) {
      clearedDependents.push(
        ...collectClearedDependents(
          block.type,
          newBlockId,
          block.name,
          targetCurrent,
          subBlocks,
          activeCanonicalModes
        )
      )
    }

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

  const resolvedName = resolveTargetWorkflowName(
    nameRegistry,
    targetFolderId,
    sourceMeta.name,
    mode === 'replace' ? targetWorkflowId : null
  )
  // Claim the resolved name so the next workflow in this copy loop sees it taken. The DB
  // write below uses the same (folderId, name), so the registry stays consistent with it.
  nameRegistry.claim(targetFolderId, resolvedName, targetWorkflowId)

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
      // Deployment visibility follows the source on sync (a public source stays public in
      // the target); fork-create omits the field, so the child starts private.
      ...(sourceMeta.isPublicApi !== undefined ? { isPublicApi: sourceMeta.isPublicApi } : {}),
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
        ...(sourceMeta.isPublicApi !== undefined ? { isPublicApi: sourceMeta.isPublicApi } : {}),
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
    clearedDependents,
    blockIdMapping,
  }
}
