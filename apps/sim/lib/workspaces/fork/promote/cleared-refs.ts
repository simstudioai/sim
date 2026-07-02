import { mcpServers, workflow } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type {
  ForkClearedRef,
  ForkCopyableKind,
  ForkSyncBlocker,
} from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import {
  coerceObjectArray,
  isRecord,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  isCanonicalPair,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { collectForkDependentReconfigs } from '@/lib/workspaces/fork/mapping/dependent-reconfigs'
import {
  filterExistingForkTargets,
  loadForkCopyableResourceLabels,
} from '@/lib/workspaces/fork/mapping/resources'
import { isForkCopyableKind } from '@/lib/workspaces/fork/promote/promote-plan'
import {
  selectForkSyncBlockingRefs,
  toForkSyncBlockers,
} from '@/lib/workspaces/fork/promote/sync-blockers'
import type { ForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'
import {
  type ForkReference,
  type ForkReferenceResolver,
  type ForkRemapKind,
  REQUIRED_KINDS,
  remapForkSubBlocks,
} from '@/lib/workspaces/fork/remap/remap-references'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Remappable kinds excluded from the `reference` cleared-ref list. REQUIRED kinds (credential,
 * env-var) gate Sync through the kind-level required gate with their own messaging, so they must
 * not double-report here (a credential is also preserved by name once mapped, an env-var always).
 * `knowledge-document` follows its parent KB - a document under an unmapped KB is implied by the
 * KB's own cleared-ref entry, and under a mapped/copied KB it is auto-copied. Every other kind's
 * entry IS a sync blocker (cause `reference`/`workflow`): a sync proceeds only when zero
 * references would clear.
 */
const CLEARED_REF_EXCLUDED_KINDS = new Set<ForkRemapKind>([...REQUIRED_KINDS, 'knowledge-document'])

interface ClearedRefItem {
  sourceWorkflowId: string
  targetWorkflowId: string
  mode: 'create' | 'replace'
  sourceMeta: { name: string }
}

export interface CollectForkClearedRefsParams {
  items: ClearedRefItem[]
  sourceStates: Map<string, WorkflowState>
  /** Plan resolver (persisted mappings + env identity), to detect which refs are currently unmapped. */
  resolver: ForkReferenceResolver
  /** Source workflow id -> target id for THIS sync; a ref to a workflow absent here is cleared. */
  workflowIdMap: Map<string, string>
  /** Same block-id resolver the sync uses, so a candidate's blockId matches the written block. */
  resolveBlockId: ForkBlockIdResolver
  /** `${kind}:${sourceId}` -> source resource label, for the `sourceLabel` display. */
  sourceLabels: Map<string, string>
  /** Source workflow id -> name, for `workflow`-kind candidate labels. */
  sourceWorkflowNames: Map<string, string>
}

/** Strip an advanced-mode `_N` suffix so a subblock key matches its config id. */
function baseSubBlockId(key: string): string {
  return key.replace(/_\d+$/, '')
}

/**
 * Cross-workflow references (`workflow-selector`, multi-select `workflowSelector`, the
 * workspace-event trigger's multi-select `workflowIds` dropdown, nested `workflow_input` tools)
 * in a block's subBlocks. Mirrors the detection in
 * {@link remapWorkflowReferencesInSubBlocks} so the cleared-ref list flags exactly the refs that
 * remap would clear - the free-form manual fields (`manualWorkflowId`, `manualWorkflowIds`) are
 * user-owned and never remapped/cleared, so they are intentionally excluded (the `workflowIds`
 * branch is gated on TYPE `dropdown` because the legacy logs block's `workflowIds` is a manual
 * `short-input`). Returns one entry per referenced workflow id with its owning subblock key.
 */
function collectForkWorkflowReferences(
  subBlocks: SubBlockRecord,
  config: ReturnType<typeof getBlock>,
  canonicalModes: CanonicalModeOverrides | undefined
): Array<{ workflowId: string; subBlockKey: string }> {
  const out: Array<{ workflowId: string; subBlockKey: string }> = []
  // Collapse each canonical pair to its ACTIVE member: only the selector members are
  // remapped/cleared (the advanced `manualWorkflowId`/`manualWorkflowIds` are user-owned and
  // preserved verbatim), so a DORMANT member's stale value is not a ref that would be cleared -
  // it must not become an unresolvable sync blocker. Mirrors `isDormantCanonicalMember` in
  // remap-references.ts: the lookup is per subblock key, so the scalar `workflowId` pair, the
  // deployments block's scalar `workflowSelector` pair, and the logs block's multi-select
  // `workflowSelector` (`workflowIds` group) all resolve through their OWN group. A missing
  // config or a non-pair member is never skipped (legacy/no-pair states keep emitting).
  const canonicalIndex = config ? buildCanonicalIndex(config.subBlocks) : undefined
  const values = canonicalIndex ? buildSubBlockValues(subBlocks) : {}
  const isDormantCanonicalMember = (key: string): boolean => {
    if (!canonicalIndex) return false
    const baseKey = baseSubBlockId(key)
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[baseKey]
    const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
    if (!group || !isCanonicalPair(group)) return false
    const activeMode = resolveCanonicalMode(group, values, canonicalModes)
    return (activeMode === 'advanced') !== group.advancedIds.includes(baseKey)
  }
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (!subBlock || typeof subBlock !== 'object') continue
    const baseKey = baseSubBlockId(key)
    if (
      subBlock.type === 'workflow-selector' &&
      typeof subBlock.value === 'string' &&
      subBlock.value
    ) {
      // Only the SELECTOR is remapped/cleared; the manual member is user-owned and preserved
      // verbatim, so skip the dormant selector when advanced/manual mode is active.
      if (isDormantCanonicalMember(key)) continue
      out.push({ workflowId: subBlock.value, subBlockKey: key })
    } else if (
      baseKey === 'workflowSelector' ||
      (subBlock.type === 'dropdown' && baseKey === 'workflowIds')
    ) {
      if (isDormantCanonicalMember(key)) continue
      const ids = Array.isArray(subBlock.value)
        ? subBlock.value
        : typeof subBlock.value === 'string'
          ? subBlock.value.split(',').map((entry) => entry.trim())
          : []
      for (const id of ids) {
        if (typeof id === 'string' && id) out.push({ workflowId: id, subBlockKey: key })
      }
    } else if (subBlock.type === 'tool-input') {
      const { array } = coerceObjectArray(subBlock.value)
      if (!array) continue
      for (const tool of array) {
        if (
          isRecord(tool) &&
          tool.type === 'workflow_input' &&
          isRecord(tool.params) &&
          typeof tool.params.workflowId === 'string' &&
          tool.params.workflowId
        ) {
          out.push({ workflowId: tool.params.workflowId, subBlockKey: key })
        }
      }
    }
  }
  return out
}

/**
 * Compute the per-block/field references this sync WILL blank in the target, for the pre-sync
 * "what will be cleared" list. Three causes (see {@link ForkClearedRef}):
 *  - `reference`: an unmapped remappable resource (credential / KB / table / file / MCP server /
 *    custom tool / skill). The client filters these against the live mapping + copy selection, so an
 *    item disappears once mapped or selected for copy. Env vars (preserved) and documents (follow
 *    their KB) are excluded.
 *  - `workflow`: a cross-workflow reference to a workflow not carried into the target - always cleared.
 *  - `dependent`: a create-target dependent selector the source configured that a remapped parent
 *    clears. Carries `parentKind`/`parentSourceId` so the client can drop it once a KB parent is
 *    mapped or copied (the document follows its KB); a credential's label or a table's column is
 *    cleared on any parent remap, so it stays.
 *
 * Pure (no DB): the caller supplies the plan, source states, resolver, block-id resolver, and the
 * source label maps. Block + field labels come from the block registry / block state.
 */
export function collectForkClearedRefCandidates(
  params: CollectForkClearedRefsParams
): ForkClearedRef[] {
  const { items, sourceStates, resolver, workflowIdMap, resolveBlockId, sourceLabels } = params
  const out: ForkClearedRef[] = []
  const labelFor = (kind: string, sourceId: string) =>
    sourceLabels.get(`${kind}:${sourceId}`) ?? sourceId

  for (const item of items) {
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    for (const [sourceBlockId, block] of Object.entries(state.blocks)) {
      const config = getBlock(block.type)
      const blockLabel = block.name
      const targetBlockId = resolveBlockId(item.targetWorkflowId, sourceBlockId)
      // double-cast-allowed: a WorkflowState block's SubBlockState entries are structurally
      // SubBlockRecord entries but lack the open index signature SubBlockRecord declares
      const subBlocks = (block.subBlocks ?? {}) as unknown as SubBlockRecord
      const fieldLabel = (subBlockKey: string) =>
        config?.subBlocks.find((cfg) => cfg.id === baseSubBlockId(subBlockKey))?.title ??
        subBlockKey

      // Cause `reference`: unmapped remappable resource refs (per block/field). `blockType` +
      // `canonicalModes` gate detection to the ACTIVE canonical member, matching the plan's
      // reference scan - a dormant member's stale value is not a real reference, so it must not
      // become a blocker with no mapping entry to resolve it. `sourceDeleted` starts false; the
      // caller annotates it via {@link annotateForkClearedRefSourceLiveness} (DB check).
      const scan = remapForkSubBlocks(subBlocks, resolver, 'promote', {
        blockId: targetBlockId,
        blockName: blockLabel,
        blockType: block.type,
        canonicalModes: block.data?.canonicalModes,
      })
      for (const ref of scan.unmapped) {
        if (CLEARED_REF_EXCLUDED_KINDS.has(ref.kind)) continue
        out.push({
          targetWorkflowId: item.targetWorkflowId,
          workflowName: item.sourceMeta.name,
          blockId: targetBlockId,
          blockLabel,
          fieldLabel: fieldLabel(ref.subBlockKey),
          kind: ref.kind,
          sourceId: ref.sourceId,
          sourceLabel: labelFor(ref.kind, ref.sourceId),
          cause: 'reference',
          sourceDeleted: false,
        })
      }

      // Cause `workflow`: refs to a workflow not carried into the target.
      for (const wfRef of collectForkWorkflowReferences(
        subBlocks,
        config,
        block.data?.canonicalModes
      )) {
        if (workflowIdMap.has(wfRef.workflowId)) continue
        out.push({
          targetWorkflowId: item.targetWorkflowId,
          workflowName: item.sourceMeta.name,
          blockId: targetBlockId,
          blockLabel,
          fieldLabel: fieldLabel(wfRef.subBlockKey),
          kind: 'workflow',
          sourceId: wfRef.workflowId,
          sourceLabel: params.sourceWorkflowNames.get(wfRef.workflowId) ?? wfRef.workflowId,
          cause: 'workflow',
        })
      }
    }
  }

  // Cause `dependent`: create-target dependent selectors the source configured that a remapped
  // parent clears. Only `replace` targets get the in-place reconfigure flow; a created target has
  // no draft to re-pick against, so these would clear silently - surface them here.
  const workflowNameByTarget = new Map(items.map((i) => [i.targetWorkflowId, i.sourceMeta.name]))
  for (const dependent of collectForkDependentReconfigs(
    items,
    sourceStates,
    resolveBlockId,
    'create'
  )) {
    if (dependent.currentValue === '') continue
    out.push({
      targetWorkflowId: dependent.targetWorkflowId,
      workflowName: workflowNameByTarget.get(dependent.targetWorkflowId) ?? '',
      blockId: dependent.targetBlockId,
      blockLabel: dependent.blockName,
      fieldLabel: dependent.title,
      kind: dependent.parentKind,
      sourceId: dependent.parentSourceId,
      sourceLabel: labelFor(dependent.parentKind, dependent.parentSourceId),
      cause: 'dependent',
      // The dependsOn parent (its KB/credential/table). The client drops this entry once the parent
      // is mapped or copied ONLY when the child follows it (a document under a KB); a credential's
      // label or a table's column is cleared on any parent remap, so it stays.
      parentKind: dependent.parentKind,
      parentSourceId: dependent.parentSourceId,
    })
  }

  return out
}

/**
 * Fill each `reference`-cause entry's `sourceDeleted` flag by checking whether its resource still
 * exists (not deleted/archived) in the SOURCE workspace. Reuses {@link filterExistingForkTargets}
 * - a per-kind, exact-id (cap-free) liveness check with the canonical archived/deleted filters -
 * pointed at the source workspace instead of a target. One batched round per kind present; a
 * no-op (zero queries) when no reference-cause entries exist. Files check by storage key, matching
 * how `file` references are recorded.
 */
export async function annotateForkClearedRefSourceLiveness(
  executor: DbOrTx,
  sourceWorkspaceId: string,
  clearedRefs: ForkClearedRef[]
): Promise<ForkClearedRef[]> {
  const idsByKind: Partial<Record<ForkRemapKind, Set<string>>> = {}
  for (const ref of clearedRefs) {
    if (ref.cause !== 'reference') continue
    ;(idsByKind[ref.kind] ??= new Set()).add(ref.sourceId)
  }
  if (Object.keys(idsByKind).length === 0) return clearedRefs
  const liveByKind = await filterExistingForkTargets(executor, sourceWorkspaceId, idsByKind)
  return clearedRefs.map((ref) =>
    ref.cause === 'reference'
      ? { ...ref, sourceDeleted: !(liveByKind[ref.kind]?.has(ref.sourceId) ?? false) }
      : ref
  )
}

/** Upper bound on the blockers a gate failure reports, so the error body stays sane. */
const FORK_SYNC_BLOCKER_LIMIT = 100

/**
 * Cheap existence check for blocking gate candidates, reusing the plan's already-computed scan
 * output instead of re-running the full per-block reference scan:
 *  - `reference` cause: the collector detects references with the same per-block scan
 *    ({@link remapForkSubBlocks}) over the same source states the plan already ran, so a
 *    candidate exists iff some plan-unmapped reference of a non-excluded kind still resolves to
 *    null through the gate resolver. The gate resolver only ADDS resolutions on top of the plan
 *    resolver (promote's copy-selection overlay), so filtering the plan's unmapped set through it
 *    yields exactly the gate's unmapped set. The plan's cascade-only additions (env-var /
 *    credential) are excluded kinds and never contribute.
 *  - `workflow` cause: cross-workflow refs are not part of the plan's scan, so walk the blocks
 *    with the (much lighter) workflow-reference detection only, against the same workflowIdMap
 *    predicate the collector applies.
 * `dependent`-cause candidates never block (see {@link forkSyncBlockerReasonFor}), so they are
 * not checked.
 */
function hasForkSyncBlockerCandidates(
  planUnmapped: ReadonlyArray<Pick<ForkReference, 'kind' | 'sourceId'>>,
  params: Pick<
    CollectForkClearedRefsParams,
    'items' | 'sourceStates' | 'resolver' | 'workflowIdMap'
  >
): boolean {
  const { items, sourceStates, resolver, workflowIdMap } = params
  const hasReferenceCandidate = planUnmapped.some(
    (reference) =>
      !CLEARED_REF_EXCLUDED_KINDS.has(reference.kind) &&
      resolver(reference.kind, reference.sourceId) == null
  )
  if (hasReferenceCandidate) return true
  for (const item of items) {
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    for (const block of Object.values(state.blocks)) {
      // double-cast-allowed: a WorkflowState block's SubBlockState entries are structurally
      // SubBlockRecord entries but lack the open index signature SubBlockRecord declares
      const subBlocks = (block.subBlocks ?? {}) as unknown as SubBlockRecord
      const workflowRefs = collectForkWorkflowReferences(
        subBlocks,
        getBlock(block.type),
        block.data?.canonicalModes
      )
      if (workflowRefs.some((ref) => !workflowIdMap.has(ref.workflowId))) return true
    }
  }
  return false
}

/**
 * The authoritative would-clear gate input for a promote: collect the cleared-ref candidates for
 * the sync (against the caller's resolver, which must already account for the copy selection),
 * keep the blocking causes (`reference` / `workflow` - dependents stay with the reconfigure
 * flow), annotate source liveness, and return them as wire {@link ForkSyncBlocker}s with
 * best-effort labels. The happy path (nothing would clear) costs ZERO queries - the collection is
 * pure over the pre-read source states - and, when `planUnmapped` is supplied, ZERO re-scans of
 * the blocks the plan already scanned; liveness + label reads (and the full candidate collection,
 * for identical per-block/field blocker rows) run only when something blocks. Truncated to
 * {@link FORK_SYNC_BLOCKER_LIMIT} entries.
 */
export async function collectForkSyncBlockers(
  params: Omit<CollectForkClearedRefsParams, 'sourceLabels' | 'sourceWorkflowNames'> & {
    executor: DbOrTx
    sourceWorkspaceId: string
    /**
     * The plan's unmapped references (`unmappedRequired` + `unmappedOptional`), when the caller
     * computed the plan over the SAME `items`/`sourceStates` inside the same transaction AND the
     * gate `resolver` only augments the plan's resolver (never un-resolves a plan-mapped ref) -
     * promote's copy-selection overlay satisfies both. Enables the happy-path shortcut via
     * {@link hasForkSyncBlockerCandidates}: the full per-block reference scan the plan already
     * ran is skipped when no blocking candidate can exist, and re-run (for byte-identical blocker
     * rows) when one does. Omit to always collect from scratch.
     */
    planUnmapped?: ReadonlyArray<Pick<ForkReference, 'kind' | 'sourceId'>>
  }
): Promise<ForkSyncBlocker[]> {
  const { executor, sourceWorkspaceId, planUnmapped, ...collectParams } = params
  if (planUnmapped && !hasForkSyncBlockerCandidates(planUnmapped, collectParams)) return []
  const candidates = collectForkClearedRefCandidates({
    ...collectParams,
    sourceLabels: new Map(),
    sourceWorkflowNames: new Map(),
  })
  if (!candidates.some((ref) => ref.cause === 'reference' || ref.cause === 'workflow')) return []

  const annotated = await annotateForkClearedRefSourceLiveness(
    executor,
    sourceWorkspaceId,
    candidates
  )
  const blocking = selectForkSyncBlockingRefs(annotated).slice(0, FORK_SYNC_BLOCKER_LIMIT)
  if (blocking.length === 0) return []

  // Best-effort display labels (failure path only). Copyable kinds go through the shared label
  // loader (live rows only - a deleted source keeps its id label); MCP servers are read without
  // the deleted filter so a source-deleted server still names itself; workflow names label the
  // `workflow`-cause entries.
  const copyableIdsByKind: Partial<Record<ForkCopyableKind, string[]>> = {}
  const mcpIds: string[] = []
  const workflowIds: string[] = []
  for (const { ref } of blocking) {
    if (ref.cause === 'workflow') workflowIds.push(ref.sourceId)
    else if (ref.kind === 'mcp-server') mcpIds.push(ref.sourceId)
    else if (isForkCopyableKind(ref.kind)) (copyableIdsByKind[ref.kind] ??= []).push(ref.sourceId)
  }
  const [copyableLabels, mcpRows, workflowRows] = await Promise.all([
    loadForkCopyableResourceLabels(executor, sourceWorkspaceId, copyableIdsByKind),
    mcpIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : executor
          .select({ id: mcpServers.id, name: mcpServers.name })
          .from(mcpServers)
          .where(
            and(eq(mcpServers.workspaceId, sourceWorkspaceId), inArray(mcpServers.id, mcpIds))
          ),
    workflowIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : executor
          .select({ id: workflow.id, name: workflow.name })
          .from(workflow)
          .where(
            and(eq(workflow.workspaceId, sourceWorkspaceId), inArray(workflow.id, workflowIds))
          ),
  ])
  const mcpNames = new Map(mcpRows.map((row) => [row.id, row.name]))
  const workflowNames = new Map(workflowRows.map((row) => [row.id, row.name]))
  const labelFor = (ref: ForkClearedRef): string => {
    if (ref.cause === 'workflow') return workflowNames.get(ref.sourceId) ?? ref.sourceLabel
    if (ref.kind === 'mcp-server') return mcpNames.get(ref.sourceId) ?? ref.sourceLabel
    return copyableLabels.get(`${ref.kind}:${ref.sourceId}`)?.label ?? ref.sourceLabel
  }

  return toForkSyncBlockers(
    blocking.map(({ ref, reason }) => ({ ref: { ...ref, sourceLabel: labelFor(ref) }, reason }))
  )
}
