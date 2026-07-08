import { workflow } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { type ForkCopyableKind, forkCopyableKindSchema } from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import type { DeployedWorkflowSummary } from '@/lib/workspaces/fork/copy/deploy-bridge'
import type { ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import { detectForkCascadeReferences } from '@/lib/workspaces/fork/mapping/cascade'
import {
  buildForkResolver,
  getEdgeMappingRows,
  resourceTypeToForkKind,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import {
  type ForkCopyableLabel,
  type ForkCopyableSourceResource,
  filterExistingForkTargets,
  getWorkspaceEnvKeys,
  listForkCopyableSourceResources,
  loadForkCopyableResourceLabels,
} from '@/lib/workspaces/fork/mapping/resources'
import { toScannerBlocks } from '@/lib/workspaces/fork/remap/reference-scan'
import {
  type ForkReference,
  type ForkReferenceResolver,
  type ForkRemapKind,
  scanWorkflowReferences,
} from '@/lib/workspaces/fork/remap/remap-references'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface ForkPromotePlanItem {
  sourceWorkflowId: string
  targetWorkflowId: string
  /** The matched target workflow's current name (for rename-aware mapping), null when creating. */
  targetName: string | null
  mode: 'create' | 'replace'
  sourceMeta: {
    name: string
    description: string | null
    folderId: string | null
    sortOrder: number
    /** Source's public-API flag, carried onto the written target (see copyWorkflowStateIntoTarget). */
    isPublicApi: boolean
  }
}

export interface ForkPromotePlan {
  childWorkspaceId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  resolver: ForkReferenceResolver
  items: ForkPromotePlanItem[]
  workflowIdMap: Map<string, string>
  /** Previously-mapped target workflows whose source no longer exists (to remove). */
  archivedTargetIds: string[]
  /** Same as `archivedTargetIds`, with the target workflow name for the preview. */
  archivedTargets: Array<{ id: string; name: string }>

  references: ForkReference[]
  unmappedRequired: ForkReference[]
  unmappedOptional: ForkReference[]
  /** Source MCP server ids that use OAuth and need re-authorization in the target. */
  mcpReauthServerIds: string[]
  /** Review-only descriptions of inline secrets that cannot be id-mapped. */
  inlineSecretSources: string[]
  /**
   * Unmapped resources of copyable kinds that still exist in the source, so a sync can copy
   * them into the target instead of requiring a manual mapping (U15). `referenced: true`
   * entries are referenced by the synced workflows (default-selected in the modal - skipping
   * one clears its references); `referenced: false` entries are used by no synced workflow
   * (default-unselected - skipping one breaks nothing). Documents are auto-copied with their
   * parent KB and are not listed here. `parentId`/`parentLabel` carry a file's folder grouping
   * (null for non-file kinds and root files), for the nested picker.
   */
  copyableUnmapped: Array<{
    kind: ForkCopyableKind
    sourceId: string
    label: string
    parentId: string | null
    parentLabel: string | null
    referenced: boolean
  }>
  willUpdate: number
  willCreate: number
  willArchive: number
}

/**
 * Copyable promote kinds, derived from the wire contract (`forkCopyableKindSchema`) so this
 * guard can never drift from the single source of truth: growing the schema automatically
 * grows the set. Typed as `ForkRemapKind` so `.has` accepts a broad scan-reference kind.
 */
const COPYABLE_PROMOTE_KINDS = new Set<ForkRemapKind>(forkCopyableKindSchema.options)

export function isForkCopyableKind(kind: ForkRemapKind): kind is ForkCopyableKind {
  return COPYABLE_PROMOTE_KINDS.has(kind)
}

/**
 * Build the cross-workflow reference map used to rewrite `workflow-selector`,
 * `manualWorkflowId`, and `workflow_input` references inside promoted workflows.
 *
 * Seeded from the persistent identity mappings - not just the workflows in THIS
 * push - so a reference to a mapped sibling that isn't part of the current push
 * (e.g. a workflow undeployed in the source but still existing and already
 * deployed in the target) repoints at the existing target instead of clearing.
 * Only pairs whose source still EXISTS and whose target is still ACTIVE are
 * seeded: a deleted source (whose target is archived this push) stays unmapped so
 * its inbound references clear, and a target archived by a prior push is never
 * re-pointed at. The push's own items are overlaid last, so a created workflow
 * contributes its fresh target id and a replaced one re-sets the same id.
 */
export function buildPromoteWorkflowIdMap(params: {
  identityMap: Map<string, string>
  existingSourceIds: Set<string>
  targetActiveIds: Set<string>
  items: Array<{ sourceWorkflowId: string; targetWorkflowId: string }>
}): Map<string, string> {
  const { identityMap, existingSourceIds, targetActiveIds, items } = params
  const workflowIdMap = new Map<string, string>()
  for (const [sourceId, targetId] of identityMap) {
    if (existingSourceIds.has(sourceId) && targetActiveIds.has(targetId)) {
      workflowIdMap.set(sourceId, targetId)
    }
  }
  for (const item of items) workflowIdMap.set(item.sourceWorkflowId, item.targetWorkflowId)
  return workflowIdMap
}

/**
 * Collect the source ids of referenced-but-unmapped copyable resources, grouped by kind - the input
 * to the source-label lookup that builds {@link ForkPromotePlan.copyableUnmapped}. Pure.
 */
export function collectForkCopyableIdsByKind(
  unmappedReferences: ForkReference[]
): Partial<Record<ForkCopyableKind, string[]>> {
  const byKind: Partial<Record<ForkCopyableKind, string[]>> = {}
  for (const reference of unmappedReferences) {
    if (!isForkCopyableKind(reference.kind)) continue
    ;(byKind[reference.kind] ??= []).push(reference.sourceId)
  }
  return byKind
}

/**
 * Assemble the REFERENCED slice of {@link ForkPromotePlan.copyableUnmapped} from the unmapped
 * references and the loaded source labels: each copyable reference whose label resolved becomes a
 * copy candidate; one whose label is missing (the resource no longer exists in the source) is
 * dropped. Pure - split from the DB label load so it is unit-testable.
 */
export function assembleForkCopyableUnmapped(
  unmappedReferences: ForkReference[],
  copyableLabels: Map<string, ForkCopyableLabel>
): ForkPromotePlan['copyableUnmapped'] {
  return unmappedReferences.flatMap((reference) => {
    if (!isForkCopyableKind(reference.kind)) return []
    const entry = copyableLabels.get(`${reference.kind}:${reference.sourceId}`)
    return entry
      ? [
          {
            kind: reference.kind,
            sourceId: reference.sourceId,
            label: entry.label,
            parentId: entry.parentId,
            parentLabel: entry.parentLabel,
            referenced: true,
          },
        ]
      : []
  })
}

/**
 * Assemble the UNREFERENCED slice of {@link ForkPromotePlan.copyableUnmapped}: every copyable
 * resource in the source workspace that no synced workflow references (not in the referenced
 * candidate set) and that has no target mapping for this edge (the resolver returns null). A
 * previously-copied resource resolves through its persisted `workspace_fork_resource_map` row,
 * so a re-sync never re-offers it (idempotency). Pure - split from the DB source listing so it
 * is unit-testable.
 */
export function collectForkUnreferencedCopyables(
  sourceResources: ForkCopyableSourceResource[],
  referencedCopyables: ForkPromotePlan['copyableUnmapped'],
  resolver: ForkReferenceResolver
): ForkPromotePlan['copyableUnmapped'] {
  const referencedKeys = new Set(
    referencedCopyables.map((candidate) => `${candidate.kind}:${candidate.sourceId}`)
  )
  return sourceResources.flatMap((resource) => {
    if (referencedKeys.has(`${resource.kind}:${resource.sourceId}`)) return []
    if (resolver(resource.kind, resource.sourceId) != null) return []
    return [{ ...resource, referenced: false }]
  })
}

/**
 * Compute everything a promote needs without mutating. Only the source's
 * **deployed** workflows participate; each plan item carries the source's active
 * deployed state. Targets matched by the persisted workflow identity map are
 * replaced; unmatched deployed sources create new targets. A target is archived
 * only when it was previously mapped and its source is no longer deployed -
 * target-native workflows are never touched. Shared by the diff preview and the
 * promote orchestrator.
 */
export async function computeForkPromotePlan(params: {
  executor: DbOrTx
  edge: ForkEdge
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  /**
   * Source deployed workflows + their states, read by the caller BEFORE its
   * transaction (see `loadSourceDeployedStates`) so the plan never checks out a
   * second pooled connection from inside a tx.
   */
  deployedSourceWorkflows: DeployedWorkflowSummary[]
  sourceStates: Map<string, WorkflowState>
}): Promise<ForkPromotePlan> {
  const {
    executor,
    edge,
    sourceWorkspaceId,
    targetWorkspaceId,
    direction,
    deployedSourceWorkflows,
    sourceStates,
  } = params

  const mappingRows = await getEdgeMappingRows(executor, edge.childWorkspaceId)
  const [targetEnvKeys, sourceEnvKeys] = await Promise.all([
    getWorkspaceEnvKeys(executor, targetWorkspaceId),
    getWorkspaceEnvKeys(executor, sourceWorkspaceId),
  ])
  const sourceIsParent = sourceWorkspaceId === edge.parentWorkspaceId

  // Collect each mapping's chosen target id (per kind) and keep only those that still
  // exist in the target workspace, so a target deleted after the mapping was saved
  // resolves as unmapped instead of writing a dead id into the promoted workflow.
  const mappedTargetIdsByKind: Partial<Record<ForkRemapKind, Set<string>>> = {}
  for (const row of mappingRows) {
    const kind = resourceTypeToForkKind(row.resourceType)
    if (!kind) continue
    const targetId = sourceIsParent ? row.childResourceId : row.parentResourceId
    if (targetId == null) continue
    const set = mappedTargetIdsByKind[kind] ?? new Set<string>()
    set.add(targetId)
    mappedTargetIdsByKind[kind] = set
  }
  const validTargetIdsByKind = await filterExistingForkTargets(
    executor,
    targetWorkspaceId,
    mappedTargetIdsByKind
  )

  const resolver = buildForkResolver(mappingRows, {
    sourceIsParent,
    targetEnvKeys,
    sourceEnvKeys,
    validTargetIdsByKind,
  })

  const identityMap = new Map<string, string>()
  for (const row of mappingRows) {
    if (row.resourceType !== 'workflow' || row.childResourceId == null) continue
    if (sourceIsParent) identityMap.set(row.parentResourceId, row.childResourceId)
    else identityMap.set(row.childResourceId, row.parentResourceId)
  }

  const [targetWorkflows, sourceWorkflowRows] = await Promise.all([
    executor
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, targetWorkspaceId), isNull(workflow.archivedAt))),
    executor
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, sourceWorkspaceId), isNull(workflow.archivedAt))),
  ])

  const targetActiveIds = new Set(targetWorkflows.map((w) => w.id))
  const targetNameById = new Map(targetWorkflows.map((w) => [w.id, w.name]))
  // Every source workflow that still EXISTS (deployed or not). A mapped target is
  // archived only when its source was DELETED - not merely undeployed. A fresh fork
  // leaves the child's workflows undeployed, so pushing back must not archive the
  // parent's originals; undeployed sources are simply skipped (target left as-is).
  const existingSourceIds = new Set(sourceWorkflowRows.map((w) => w.id))

  // Build the items and scan references in one pass from the pre-read source states
  // (loaded before the caller's transaction; see loadSourceDeployedStates).
  const items: ForkPromotePlanItem[] = []
  const referenceByKey = new Map<string, ForkReference>()
  for (const source of deployedSourceWorkflows) {
    const sourceState = sourceStates.get(source.id)
    if (!sourceState) continue

    const mappedTargetId = identityMap.get(source.id)
    const isReplace = Boolean(mappedTargetId && targetActiveIds.has(mappedTargetId))
    const targetWorkflowId = isReplace ? (mappedTargetId as string) : generateId()
    items.push({
      sourceWorkflowId: source.id,
      targetWorkflowId,
      targetName: isReplace ? (targetNameById.get(targetWorkflowId) ?? null) : null,
      mode: isReplace ? 'replace' : 'create',
      sourceMeta: {
        name: source.name,
        description: source.description,
        folderId: source.folderId,
        sortOrder: source.sortOrder,
        isPublicApi: source.isPublicApi,
      },
    })

    for (const reference of scanWorkflowReferences(toScannerBlocks(sourceState), resolver)
      .references) {
      referenceByKey.set(`${reference.kind}:${reference.sourceId}`, reference)
    }
  }

  const workflowIdMap = buildPromoteWorkflowIdMap({
    identityMap,
    existingSourceIds,
    targetActiveIds,
    items,
  })

  const writtenTargetIds = new Set(items.map((item) => item.targetWorkflowId))
  const archivedTargetIds: string[] = []
  for (const row of mappingRows) {
    if (row.resourceType !== 'workflow' || row.childResourceId == null) continue
    const mappedSourceId = sourceIsParent ? row.parentResourceId : row.childResourceId
    const mappedTargetId = sourceIsParent ? row.childResourceId : row.parentResourceId
    if (existingSourceIds.has(mappedSourceId)) continue
    if (writtenTargetIds.has(mappedTargetId)) continue
    if (targetActiveIds.has(mappedTargetId)) archivedTargetIds.push(mappedTargetId)
  }
  const archivedTargets = archivedTargetIds.map((id) => ({
    id,
    name: targetNameById.get(id) ?? id,
  }))

  const cascade = await detectForkCascadeReferences({
    executor,
    sourceWorkspaceId,
    references: Array.from(referenceByKey.values()),
    resolve: resolver,
  })
  for (const reference of cascade.references) {
    referenceByKey.set(`${reference.kind}:${reference.sourceId}`, reference)
  }

  const allReferences = Array.from(referenceByKey.values())
  const allUnmapped = allReferences.filter(
    (reference) => resolver(reference.kind, reference.sourceId) == null
  )
  const unmappedRequired = allUnmapped.filter((reference) => reference.required)
  const unmappedOptional = allUnmapped.filter((reference) => !reference.required)

  // Referenced-but-unmapped resources of copyable kinds that still exist in the source, so the
  // sync modal can offer to copy them into the target (fork-style) instead of mapping by hand.
  const copyableLabels = await loadForkCopyableResourceLabels(
    executor,
    sourceWorkspaceId,
    collectForkCopyableIdsByKind(allUnmapped)
  )
  const referencedCopyables = assembleForkCopyableUnmapped(allUnmapped, copyableLabels)
  // Also offer the source's UNREFERENCED copyable resources with no target mapping (e.g. newly
  // created since the fork), default-unselected in the modal. Mapped ones (including everything
  // a prior sync copied) resolve non-null and drop out, so a re-sync never re-offers a copy.
  const sourceCopyables = await listForkCopyableSourceResources(executor, sourceWorkspaceId)
  const copyableUnmapped = [
    ...referencedCopyables,
    ...collectForkUnreferencedCopyables(sourceCopyables, referencedCopyables, resolver),
  ]

  const willUpdate = items.filter((i) => i.mode === 'replace').length
  const willCreate = items.filter((i) => i.mode === 'create').length

  return {
    childWorkspaceId: edge.childWorkspaceId,
    sourceWorkspaceId,
    targetWorkspaceId,
    direction,
    resolver,
    items,
    workflowIdMap,
    archivedTargetIds,
    archivedTargets,
    references: allReferences,
    unmappedRequired,
    unmappedOptional,
    mcpReauthServerIds: cascade.mcpReauthServerIds,
    inlineSecretSources: cascade.inlineSecretSources,
    copyableUnmapped,
    willUpdate,
    willCreate,
    willArchive: archivedTargetIds.length,
  }
}
