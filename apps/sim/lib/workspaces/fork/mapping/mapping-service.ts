import { db } from '@sim/db'
import type { ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import { listDeployedWorkflows, readDeployedState } from '@/lib/workspaces/fork/copy/deploy-bridge'
import { ForkError } from '@/lib/workspaces/fork/lineage/authz'
import type { ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import { detectForkCascadeReferences } from '@/lib/workspaces/fork/mapping/cascade'
import {
  buildForkResolver,
  deleteEdgeMappingByChildResource,
  type ForkMappingRow,
  type ForkResourceType,
  getEdgeMappingRows,
  nonCredentialForkKindToResourceType,
  resourceTypeToForkKind,
  upsertEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import {
  classifyCredentialResourceType,
  type ForkResourceCandidate,
  getWorkspaceEnvKeys,
  listForkResourceCandidates,
} from '@/lib/workspaces/fork/mapping/resources'
import {
  type ForkReference,
  type ForkRemapKind,
  scanWorkflowReferences,
} from '@/lib/workspaces/fork/remap/remap-references'

interface ForkMappingViewParams {
  edge: ForkEdge
  sourceWorkspaceId: string
  targetWorkspaceId: string
}

function suggestTarget(
  kind: ForkRemapKind,
  sourceLabel: string,
  sourceProviderId: string | undefined,
  candidates: ForkResourceCandidate[]
): string | null {
  const normalized = sourceLabel.trim().toLowerCase()
  const byLabel = candidates.filter((c) => c.label.trim().toLowerCase() === normalized)
  if (kind === 'credential' && sourceProviderId) {
    const match = byLabel.find((c) => c.providerId === sourceProviderId)
    if (match) return match.id
  }
  if (byLabel.length === 1) return byLabel[0].id
  return null
}

/**
 * Build the direction-oriented mapping view: every detected source reference with
 * its current target (persisted or env identity), an auto-suggested target by
 * name/provider, and the list of target candidates the UI can choose from.
 */
export async function getForkMappingView(
  params: ForkMappingViewParams
): Promise<{ entries: ForkMappingEntry[] }> {
  const { edge, sourceWorkspaceId, targetWorkspaceId } = params
  const sourceIsParent = sourceWorkspaceId === edge.parentWorkspaceId

  const [mappingRows, targetEnvKeys, sourceEnvKeys, sourceCandidates, targetCandidates] =
    await Promise.all([
      getEdgeMappingRows(db, edge.childWorkspaceId),
      getWorkspaceEnvKeys(db, targetWorkspaceId),
      getWorkspaceEnvKeys(db, sourceWorkspaceId),
      listForkResourceCandidates(db, sourceWorkspaceId),
      listForkResourceCandidates(db, targetWorkspaceId),
    ])

  const resolver = buildForkResolver(mappingRows, { sourceIsParent, targetEnvKeys, sourceEnvKeys })

  const resourceTypeBySourceId = new Map<string, ForkResourceType>()
  for (const row of mappingRows) {
    const key = sourceIsParent ? row.parentResourceId : row.childResourceId
    if (key) resourceTypeBySourceId.set(key, row.resourceType)
  }

  // Scan one deployed workflow state at a time and merge deduped references, so
  // peak memory stays at a single workflow state rather than all of them at once.
  const deployedWorkflows = await listDeployedWorkflows(db, sourceWorkspaceId)
  const referenceByKey = new Map<string, ForkReference>()
  for (const wf of deployedWorkflows) {
    const state = await readDeployedState(wf.id, sourceWorkspaceId)
    if (!state) continue
    const blocks = Object.values(state.blocks).map((block) => ({
      id: block.id,
      name: block.name,
      subBlocks: block.subBlocks as unknown,
    }))
    for (const reference of scanWorkflowReferences(blocks, () => null).references) {
      referenceByKey.set(`${reference.kind}:${reference.sourceId}`, reference)
    }
  }

  const cascade = await detectForkCascadeReferences({
    executor: db,
    sourceWorkspaceId,
    references: Array.from(referenceByKey.values()),
    resolve: () => null,
  })
  for (const reference of cascade.references) {
    referenceByKey.set(`${reference.kind}:${reference.sourceId}`, reference)
  }
  const references: ForkReference[] = Array.from(referenceByKey.values())

  const entries: ForkMappingEntry[] = []
  for (const reference of references) {
    // Only SOURCE workspace secrets are mappable; a `{{KEY}}` that isn't a source
    // workspace env var is a personal (user-scoped) secret - leave it as-is.
    if (reference.kind === 'env-var' && !sourceEnvKeys.has(reference.sourceId)) continue
    let resourceType = resourceTypeBySourceId.get(reference.sourceId)
    if (!resourceType) {
      resourceType =
        reference.kind === 'credential'
          ? await classifyCredentialResourceType(db, reference.sourceId, sourceWorkspaceId)
          : nonCredentialForkKindToResourceType(reference.kind)
    }

    const sourceCandidate = sourceCandidates[reference.kind].find(
      (c) => c.id === reference.sourceId
    )
    const sourceLabel = sourceCandidate?.label ?? reference.sourceId
    const candidates = targetCandidates[reference.kind]
    const currentTargetId = resolver(reference.kind, reference.sourceId)
    const targetId =
      currentTargetId ??
      suggestTarget(reference.kind, sourceLabel, sourceCandidate?.providerId, candidates)

    entries.push({
      kind: reference.kind,
      resourceType,
      sourceId: reference.sourceId,
      sourceLabel,
      targetId,
      required: reference.required,
      candidates,
    })
  }

  return { entries }
}

export interface ApplyForkMappingEntry {
  resourceType: ForkResourceType
  sourceId: string
  targetId: string | null
}

/**
 * Persist mapping edits for a direction. Pull maps a parent source to a child
 * target; push maps a child source to a parent target (clearing a push mapping
 * deletes the row).
 */
export async function applyForkMappingEntries(
  tx: DbOrTx,
  edge: ForkEdge,
  userId: string,
  direction: 'push' | 'pull',
  entries: ApplyForkMappingEntry[]
): Promise<number> {
  let updated = 0
  for (const entry of entries) {
    if (direction === 'pull') {
      await upsertEdgeMappings(tx, edge.childWorkspaceId, userId, [
        {
          resourceType: entry.resourceType,
          parentResourceId: entry.sourceId,
          childResourceId: entry.targetId,
        },
      ])
      updated += 1
      continue
    }
    // Push rows are keyed by the child (source) side, but the table's unique key is
    // on the parent side - so always clear any existing row for this source first,
    // otherwise changing a push target leaves the old (parent, source) row behind
    // and resolution becomes ambiguous.
    await deleteEdgeMappingByChildResource(
      tx,
      edge.childWorkspaceId,
      entry.resourceType,
      entry.sourceId
    )
    if (entry.targetId != null) {
      await upsertEdgeMappings(tx, edge.childWorkspaceId, userId, [
        {
          resourceType: entry.resourceType,
          parentResourceId: entry.targetId,
          childResourceId: entry.sourceId,
        },
      ])
    }
    updated += 1
  }
  return updated
}

/**
 * Reject mapping entries whose chosen target does not belong to the target
 * workspace, so a caller cannot point a remapped reference (or credential-access
 * propagation) at a resource in a workspace they do not administer. Kinds whose
 * candidates aren't enumerable (file, knowledge-document) are skipped.
 */
export async function validateForkMappingTargets(
  targetWorkspaceId: string,
  entries: ApplyForkMappingEntry[]
): Promise<void> {
  const hasTargets = entries.some((entry) => entry.targetId != null)
  if (!hasTargets) return
  const candidates = await listForkResourceCandidates(db, targetWorkspaceId)
  for (const entry of entries) {
    if (entry.targetId == null) continue
    const kind = resourceTypeToForkKind(entry.resourceType)
    if (!kind) continue
    const list = candidates[kind]
    // An empty candidate list means the target workspace has no admissible
    // resource of this kind, so ANY non-null target is invalid - reject rather
    // than wave it through (the previous early-continue was the security hole).
    if (!list.some((candidate) => candidate.id === entry.targetId)) {
      throw new ForkError(
        `Mapping target "${entry.targetId}" is not a valid ${kind} in the target workspace`,
        400
      )
    }
  }
}

export type { ForkMappingRow }
