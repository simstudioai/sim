import { workflow } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { DeployedWorkflowSummary } from '@/lib/workspaces/fork/copy/deploy-bridge'
import type { ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import { detectForkCascadeReferences } from '@/lib/workspaces/fork/mapping/cascade'
import { buildForkResolver, getEdgeMappingRows } from '@/lib/workspaces/fork/mapping/mapping-store'
import { getWorkspaceEnvKeys } from '@/lib/workspaces/fork/mapping/resources'
import { getPromoteRunForEdge } from '@/lib/workspaces/fork/promote/promote-run-store'
import {
  type ForkReference,
  type ForkReferenceResolver,
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
  willUpdate: number
  willCreate: number
  willArchive: number
  drift: boolean
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
  const resolver = buildForkResolver(mappingRows, { sourceIsParent, targetEnvKeys, sourceEnvKeys })

  const identityMap = new Map<string, string>()
  for (const row of mappingRows) {
    if (row.resourceType !== 'workflow' || row.childResourceId == null) continue
    if (sourceIsParent) identityMap.set(row.parentResourceId, row.childResourceId)
    else identityMap.set(row.childResourceId, row.parentResourceId)
  }

  const [targetWorkflows, sourceWorkflowRows] = await Promise.all([
    executor
      .select({ id: workflow.id, name: workflow.name, updatedAt: workflow.updatedAt })
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
      },
    })

    const blocks = Object.values(sourceState.blocks).map((block) => ({
      id: block.id,
      name: block.name,
      subBlocks: block.subBlocks as unknown,
    }))
    for (const reference of scanWorkflowReferences(blocks, resolver).references) {
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

  const previousRun = await getPromoteRunForEdge(executor, edge.childWorkspaceId, targetWorkspaceId)
  const drift = Boolean(
    previousRun && targetWorkflows.some((w) => w.updatedAt > previousRun.createdAt)
  )

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
    willUpdate,
    willCreate,
    willArchive: archivedTargetIds.length,
    drift,
  }
}
