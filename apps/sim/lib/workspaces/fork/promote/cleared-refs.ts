import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'
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
import type { ForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'
import {
  type ForkReferenceResolver,
  type ForkRemapKind,
  REQUIRED_KINDS,
  remapForkSubBlocks,
} from '@/lib/workspaces/fork/remap/remap-references'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Remappable kinds excluded from the `reference` cleared-ref list. REQUIRED kinds (credential,
 * env-var) are BLOCKERS - they gate Sync and are resolved by mapping, never silently cleared - so
 * they must not read as "will be cleared" (a credential is also preserved by name once mapped, an
 * env-var always). `knowledge-document` follows its parent KB - a document under an unmapped KB is
 * implied by the KB's own cleared-ref entry, and under a mapped/copied KB it is auto-copied.
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
 * Cross-workflow references (`workflow-selector`, advanced `manualWorkflowId(s)`, multi-select
 * `workflowSelector`, nested `workflow_input` tools) in a block's subBlocks. Mirrors the detection
 * in {@link remapWorkflowReferencesInSubBlocks} so the cleared-ref list flags exactly the refs that
 * remap would clear. Returns one entry per referenced workflow id with its owning subblock key.
 */
function collectForkWorkflowReferences(
  subBlocks: SubBlockRecord,
  config: ReturnType<typeof getBlock>,
  canonicalModes: CanonicalModeOverrides | undefined
): Array<{ workflowId: string; subBlockKey: string }> {
  const out: Array<{ workflowId: string; subBlockKey: string }> = []
  // Collapse the `workflowId` canonical pair (basic `workflow-selector` + advanced `manualWorkflowId`)
  // to its ACTIVE member: only the active mode is serialized, so a dormant stale member is not a ref
  // that would be cleared (mirrors remap-internal-ids.ts). Undefined mode -> emit both (legacy/no-pair).
  const workflowGroup = config
    ? buildCanonicalIndex(config.subBlocks).groupsById.workflowId
    : undefined
  const workflowMode =
    workflowGroup && isCanonicalPair(workflowGroup)
      ? resolveCanonicalMode(workflowGroup, buildSubBlockValues(subBlocks), canonicalModes)
      : undefined
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (!subBlock || typeof subBlock !== 'object') continue
    const baseKey = baseSubBlockId(key)
    if (
      (subBlock.type === 'workflow-selector' || baseKey === 'manualWorkflowId') &&
      typeof subBlock.value === 'string' &&
      subBlock.value
    ) {
      // Skip the dormant member of the pair (the active mode owns the reference).
      const isAdvancedMember = baseKey === 'manualWorkflowId'
      if (workflowMode && (workflowMode === 'advanced') !== isAdvancedMember) continue
      out.push({ workflowId: subBlock.value, subBlockKey: key })
    } else if (baseKey === 'manualWorkflowIds' || baseKey === 'workflowSelector') {
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

      // Cause `reference`: unmapped remappable resource refs (per block/field).
      const scan = remapForkSubBlocks(subBlocks, resolver, 'promote', {
        blockId: targetBlockId,
        blockName: blockLabel,
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
