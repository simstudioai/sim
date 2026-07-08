import { db } from '@sim/db'
import type { ForkMappableResourceType, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import { listDeployedWorkflows, readDeployedState } from '@/lib/workspaces/fork/copy/deploy-bridge'
import { ForkError } from '@/lib/workspaces/fork/lineage/authz'
import type { ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import { detectForkCascadeReferences } from '@/lib/workspaces/fork/mapping/cascade'
import {
  buildForkResolver,
  deleteEdgeMappingsByChildResources,
  type ForkResourceType,
  getEdgeMappingRows,
  nonCredentialForkKindToResourceType,
  resourceTypeToForkKind,
  upsertEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import {
  CANDIDATE_LIMIT,
  classifyCredentialResourceType,
  type ForkResourceCandidate,
  filterExistingForkTargets,
  getCredentialProvidersByIds,
  getWorkspaceEnvKeys,
  listForkResourceCandidates,
} from '@/lib/workspaces/fork/mapping/resources'
import { toScannerBlocks } from '@/lib/workspaces/fork/remap/reference-scan'
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

export function suggestTarget(
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

  const resourceTypeBySourceId = new Map<string, ForkMappableResourceType>()
  for (const row of mappingRows) {
    // Workflow + workflow-publishing-server identity rows are system-managed and document rows
    // ride their parent KB - none is user-mappable. Skip them so a scanned reference can never
    // be labeled with a non-mappable type and the view stays within the mappable-type contract.
    if (
      row.resourceType === 'workflow' ||
      row.resourceType === 'workflow_mcp_server' ||
      row.resourceType === 'knowledge_document'
    ) {
      continue
    }
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
    for (const reference of scanWorkflowReferences(toScannerBlocks(state), () => null).references) {
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

  // First pass: resolve each reference's stored target + the data to build its entry,
  // collecting stored target ids so existence is checked by exact id (cap-free) - a
  // valid mapping to a target past the display cap must be RETAINED, not shown unmapped.
  interface PendingEntry {
    reference: ForkReference
    resourceType: ForkMappableResourceType
    sourceLabel: string
    sourceProviderId: string | undefined
    candidates: ForkResourceCandidate[]
    storedTargetId: string | null
  }
  const pending: PendingEntry[] = []
  const storedTargetIdsByKind: Partial<Record<ForkRemapKind, Set<string>>> = {}

  for (const reference of references) {
    // Only SOURCE workspace secrets are mappable; a `{{KEY}}` that isn't a source
    // workspace env var is a personal (user-scoped) secret - leave it as-is.
    if (reference.kind === 'env-var' && !sourceEnvKeys.has(reference.sourceId)) continue
    // Knowledge documents are not a standalone mappable kind: a document is a dependent field
    // of its knowledge base (the `document-selector` dependsOn the KB selector), re-picked in
    // that KB's reconfigure flow and auto-remapped when the KB is copied. So a document never
    // gets its own mapping entry - it follows its parent KB's target.
    if (reference.kind === 'knowledge-document') continue
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
    const sourceProviderId = sourceCandidate?.providerId
    // A credential reference only maps to a target credential of the SAME OAuth
    // provider - a Gmail (google-email) reference must never offer a Google Calendar
    // credential. Non-credential kinds carry no provider, so their full list stands.
    const candidates =
      reference.kind === 'credential' && sourceProviderId
        ? targetCandidates[reference.kind].filter(
            (candidate) => candidate.providerId === sourceProviderId
          )
        : targetCandidates[reference.kind]
    const storedTargetId = resolver(reference.kind, reference.sourceId) ?? null
    if (storedTargetId && reference.kind !== 'env-var') {
      ;(storedTargetIdsByKind[reference.kind] ??= new Set()).add(storedTargetId)
    }
    pending.push({
      reference,
      resourceType,
      sourceLabel,
      sourceProviderId,
      candidates,
      storedTargetId,
    })
  }

  // Cap-free existence of every stored target (env vars validated against env keys).
  const existingStoredTargets = await filterExistingForkTargets(
    db,
    targetWorkspaceId,
    storedTargetIdsByKind
  )

  const entries: ForkMappingEntry[] = []
  for (const p of pending) {
    const targetExists =
      p.storedTargetId != null &&
      (p.reference.kind === 'env-var'
        ? targetEnvKeys.has(p.storedTargetId)
        : (existingStoredTargets[p.reference.kind]?.has(p.storedTargetId) ?? false))
    const currentTargetId = targetExists ? p.storedTargetId : null

    // If the retained current target isn't in the (capped) candidate list, append it
    // so the picker can still display the current selection.
    let candidates = p.candidates
    if (currentTargetId && !candidates.some((candidate) => candidate.id === currentTargetId)) {
      candidates = [...candidates, { id: currentTargetId, label: currentTargetId }]
    }

    const targetId =
      currentTargetId ??
      suggestTarget(p.reference.kind, p.sourceLabel, p.sourceProviderId, candidates)
    // True when `targetId` is an unconfirmed name/provider suggestion (no persisted
    // mapping). The modal treats a suggestion as a pending change so it shows the
    // pre-sync reconfigure rather than letting an accepted suggestion silently clear
    // dependents and surface them only after the sync.
    const suggested = currentTargetId == null && targetId != null

    entries.push({
      kind: p.reference.kind,
      resourceType: p.resourceType,
      sourceId: p.reference.sourceId,
      sourceLabel: p.sourceLabel,
      targetId,
      suggested,
      // Every entry here is a reference a synced workflow actually carries, and a sync is
      // blocked while ANY reference would clear - so every entry is required. Copyable kinds
      // (table / KB / file / custom tool / skill) also satisfy the gate by being selected for
      // copy; map-only kinds (credential / env-var / MCP server) and source-deleted resources
      // (no copy candidate) must be mapped.
      required: true,
      candidates,
      // The full (unfiltered) target list for this kind hit the cap, so the picker is
      // showing a partial list - the UI tells the user to refine.
      candidatesTruncated: targetCandidates[p.reference.kind].length >= CANDIDATE_LIMIT,
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
 * The first target two distinct sources are mapped to (same resourceType + targetId,
 * different sourceId), or null when every target is used by at most one source. Cleared
 * entries (null target) are ignored. Used by the PUSH path only: a push row is unique on
 * the parent (target) side, so such a pair collides on that unique index and one mapping
 * would be silently dropped - the caller rejects it instead. Pull is the inverse (many
 * parent sources may share one child target, which the resolver handles), so pull does not
 * use this guard.
 */
export function findDuplicateTargetEntry(
  entries: ApplyForkMappingEntry[]
): { resourceType: ForkResourceType; targetId: string } | null {
  const sourcesByTarget = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (entry.targetId == null) continue
    // Null-byte separator so a targetId containing ':' (e.g. credentialSet:...) can't
    // be confused with a different (resourceType, targetId) pair.
    const key = `${entry.resourceType}\u0000${entry.targetId}`
    const sources = sourcesByTarget.get(key)
    if (!sources) {
      sourcesByTarget.set(key, new Set([entry.sourceId]))
      continue
    }
    sources.add(entry.sourceId)
    if (sources.size > 1) return { resourceType: entry.resourceType, targetId: entry.targetId }
  }
  return null
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
  if (entries.length === 0) return 0
  if (direction === 'pull') {
    // Pull maps a parent source to a child target - one batched upsert.
    await upsertEdgeMappings(
      tx,
      edge.childWorkspaceId,
      userId,
      entries.map((entry) => ({
        resourceType: entry.resourceType,
        parentResourceId: entry.sourceId,
        childResourceId: entry.targetId,
      }))
    )
    return entries.length
  }
  // Push rows are unique on the parent (target) side, so two distinct sources mapped to
  // the same target would collide on that index and one would be silently dropped (its
  // reference then resolves unmapped). Reject loudly - on push each parent target can back
  // only one source. (Pull is the inverse: many parent sources may share one child target,
  // which the resolver handles, so pull skips this guard. The modal also disables an
  // already-taken target on push so users never reach this error normally.)
  const collision = findDuplicateTargetEntry(entries)
  if (collision) {
    const kind = resourceTypeToForkKind(collision.resourceType) ?? collision.resourceType
    throw new ForkError(
      `Two sources are mapped to the same ${kind} target. Each target can be mapped from only one source.`,
      400
    )
  }
  // Push rows are keyed by the child (source) side, but the table's unique key is on
  // the parent side - so clear any existing row for each source first (one grouped
  // delete), otherwise changing a push target leaves the old (parent, source) row
  // behind and resolution becomes ambiguous. Then upsert the new (target, source)
  // rows in one batch; a null target is a cleared mapping (delete only, no reinsert).
  await deleteEdgeMappingsByChildResources(
    tx,
    edge.childWorkspaceId,
    entries.map((entry) => ({ resourceType: entry.resourceType, childResourceId: entry.sourceId }))
  )
  await upsertEdgeMappings(
    tx,
    edge.childWorkspaceId,
    userId,
    entries
      .filter((entry) => entry.targetId != null)
      .map((entry) => ({
        resourceType: entry.resourceType,
        parentResourceId: entry.targetId as string,
        childResourceId: entry.sourceId,
      }))
  )
  return entries.length
}

/**
 * Reject mapping entries whose chosen target does not belong to the target
 * workspace, so a caller cannot point a remapped reference (or credential-access
 * propagation) at a resource in a workspace they do not administer. Entries whose
 * resource type is not user-mappable (only `workflow`, whose identity is
 * system-managed) are rejected outright. Credential targets must additionally share
 * the source credential's OAuth provider, so a Gmail reference can never be pointed
 * at a Google Calendar credential (the UI enforces this; this is the write-side
 * boundary that catches direct API calls and stale rows).
 */
export async function validateForkMappingTargets(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  entries: ApplyForkMappingEntry[]
): Promise<void> {
  const withTarget = entries.filter((entry) => entry.targetId != null)
  if (withTarget.length === 0) return

  // Collect the exact target ids per kind so existence is checked by id, NOT against
  // the display-capped candidate list - a valid target that simply sits past the cap
  // must never be rejected on save.
  const targetIdsByKind: Partial<Record<ForkRemapKind, Set<string>>> = {}
  let hasEnvVar = false
  for (const entry of withTarget) {
    const kind = resourceTypeToForkKind(entry.resourceType)
    if (!kind) {
      // `workflow` is the only null-kind type, and its identity is system-managed by
      // fork/promote/rollback. A non-null target for it here is an invalid (or
      // crafted) entry the editor must never persist.
      throw new ForkError(
        `Resource type "${entry.resourceType}" cannot be mapped via the mapping editor`,
        400
      )
    }
    if (kind === 'env-var') {
      hasEnvVar = true
      continue
    }
    ;(targetIdsByKind[kind] ??= new Set()).add(entry.targetId as string)
  }

  const credentialEntries = withTarget.filter(
    (entry) => resourceTypeToForkKind(entry.resourceType) === 'credential'
  )

  const [existingTargets, targetEnvKeys, sourceProviders, targetProviders] = await Promise.all([
    filterExistingForkTargets(db, targetWorkspaceId, targetIdsByKind),
    hasEnvVar ? getWorkspaceEnvKeys(db, targetWorkspaceId) : Promise.resolve(new Set<string>()),
    getCredentialProvidersByIds(
      db,
      sourceWorkspaceId,
      credentialEntries.map((entry) => entry.sourceId)
    ),
    getCredentialProvidersByIds(
      db,
      targetWorkspaceId,
      credentialEntries.map((entry) => entry.targetId as string)
    ),
  ])

  for (const entry of withTarget) {
    const kind = resourceTypeToForkKind(entry.resourceType)
    if (!kind) continue
    const targetId = entry.targetId as string

    if (kind === 'env-var') {
      if (!targetEnvKeys.has(targetId)) {
        throw new ForkError(
          `Mapping target "${targetId}" is not an environment variable in the target workspace`,
          400
        )
      }
      continue
    }

    if (!existingTargets[kind]?.has(targetId)) {
      throw new ForkError(
        `Mapping target "${targetId}" is not a valid ${kind} in the target workspace`,
        400
      )
    }

    if (kind === 'credential') {
      // The source must be a real credential in the source workspace. A foreign id
      // (not present) would skip the provider check and let a crafted mapping drive
      // cross-workspace credential-access propagation on promote.
      if (!sourceProviders.has(entry.sourceId)) {
        throw new ForkError(
          `Source credential "${entry.sourceId}" is not a credential in the source workspace`,
          400
        )
      }
      const sourceProviderId = sourceProviders.get(entry.sourceId)
      const targetProviderId = targetProviders.get(targetId) ?? null
      if (sourceProviderId && targetProviderId !== sourceProviderId) {
        throw new ForkError(
          `Mapping target "${targetId}" must use the same provider as the source credential`,
          400
        )
      }
    }
  }
}
