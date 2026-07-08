import { db } from '@sim/db'
import { chat, credential, credentialMember, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ForkSyncBlocker, PromoteCopyResources } from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import { notifyMcpToolServers } from '@/lib/mcp/workflow-mcp-sync'
import {
  enqueueWorkflowUndeploySideEffects,
  processWorkflowDeploymentOutboxEvent,
} from '@/lib/workflows/deployment-outbox'
import { performFullDeploy } from '@/lib/workflows/orchestration/deploy'
import { undeployWorkflow } from '@/lib/workflows/persistence/utils'
import { startBackgroundWork } from '@/lib/workspaces/fork/background-work/store'
import {
  type ForkContentCopyPayload,
  hasForkContentToCopy,
  type SerializableForkContentRefMaps,
  scheduleForkContentCopy,
} from '@/lib/workspaces/fork/copy/content-copy-runner'
import { copyForkChatDeployments } from '@/lib/workspaces/fork/copy/copy-chats'
import type { BlobCopyTask } from '@/lib/workspaces/fork/copy/copy-files'
import type { ForkContentPlan } from '@/lib/workspaces/fork/copy/copy-resources'
import {
  copyWorkflowStateIntoTarget,
  loadTargetDraftSubBlocks,
  loadWorkflowNameRegistry,
  resolveForkFolderMapping,
} from '@/lib/workspaces/fork/copy/copy-workflows'
import {
  getActiveDeploymentVersionNumbers,
  loadSourceDeployedStates,
} from '@/lib/workspaces/fork/copy/deploy-bridge'
import {
  assertForkStorageHeadroom,
  sumForkCopyBytes,
} from '@/lib/workspaces/fork/copy/storage-quota'
import { reconcileForkWorkflowMcpAttachments } from '@/lib/workspaces/fork/copy/workflow-mcp-attachments'
import {
  acquireForkEdgeLock,
  acquireForkTargetLock,
  type ForkEdge,
  setForkLockTimeout,
} from '@/lib/workspaces/fork/lineage/lineage'
import {
  type ForkBlockPair,
  loadForkBlockMap,
  reconcileForkBlockPairs,
  toForkBlockPairs,
} from '@/lib/workspaces/fork/mapping/block-map-store'
import {
  type ForkDependentValue,
  loadForkDependentValues,
  reconcileForkDependentValues,
  translateForkDependentValues,
} from '@/lib/workspaces/fork/mapping/dependent-value-store'
import {
  deleteWorkflowIdentityByIds,
  type ForkMappingUpsert,
  upsertEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import { getMcpServerMetaByIds } from '@/lib/workspaces/fork/mapping/resources'
import { collectForkSyncBlockers } from '@/lib/workspaces/fork/promote/cleared-refs'
import {
  augmentForkResolver,
  buildPromoteCopySelection,
  copyPromoteUnmappedResources,
  hasPromoteCopySelection,
} from '@/lib/workspaces/fork/promote/copy-unmapped'
import {
  computeForkPromotePlan,
  type ForkPromotePlan,
} from '@/lib/workspaces/fork/promote/promote-plan'
import {
  type PromoteRunWorkflowSnapshot,
  upsertPromoteRun,
} from '@/lib/workspaces/fork/promote/promote-run-store'
import { buildForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'
import {
  createForkSubBlockTransform,
  type ForkReference,
  type ForkReferenceResolver,
  type ForkRemapKind,
} from '@/lib/workspaces/fork/remap/remap-references'
import { notifyForkWorkflowChanged } from '@/lib/workspaces/fork/socket'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceForkPromote')

export interface PromoteForkParams {
  edge: ForkEdge
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  userId: string
  /** Initiator's display name, stamped on the sync's content-copy Activity row. */
  actorName?: string
  /**
   * The full stored mapping of dependent-field values the caller is committing (target
   * workflow id + deterministic block id + subblock key -> value). Applied to the target
   * blocks during the merge and persisted as the stored mapping. OMITTING the field (passing
   * `undefined`) leaves the existing stored mapping untouched - the store is the sole source
   * of truth and is loaded + applied as-is; an explicit `[]` clears the written replace
   * targets' mapping. This distinction keeps a programmatic promote that omits the field from
   * silently wiping the user's saved selections.
   */
  dependentValues?: Array<{
    workflowId: string
    blockId: string
    subBlockKey: string
    value: string
  }>
  /**
   * Unmapped resources (by source id) the caller chose to copy into the target before the sync
   * gate - referenced ones (their references then resolve to the new copy instead of blocking)
   * and unreferenced ones (new in the source, brought along untouched). Validated against the
   * plan's copyable candidates, so an arbitrary id is ignored.
   */
  copyResources?: PromoteCopyResources
  requestId?: string
}

export interface PromoteForkResult {
  promoteRunId: string
  updated: number
  created: number
  archived: number
  redeployed: number
  /**
   * Targets whose state was written but whose post-transaction deploy failed. The
   * draft holds the synced state; the active deployment still runs the prior version
   * until a redeploy. Surfaced (rather than swallowed) so the caller can warn.
   */
  deployFailed: number
  unmappedRequired: Array<Pick<ForkReference, 'kind' | 'sourceId' | 'required' | 'blockName'>>
  /**
   * References the sync would have cleared in the target, so it was blocked without writing
   * (`blocked: 'cleared-refs'`). The authoritative in-tx re-check of the diff's would-clear
   * preview: normally the client blocks first, so a non-empty list means the state changed
   * between preview and Sync.
   */
  blockers: ForkSyncBlocker[]
  blocked: 'unmapped' | 'cleared-refs' | null
  /** Names of the workflows the sync changed, by action, for the activity report. */
  updatedNames: string[]
  createdNames: string[]
  archivedNames: string[]
  /**
   * Workflows whose required dependent fields a parent change cleared - the target
   * must re-pick them. These were written but intentionally NOT redeployed (the prior
   * version keeps running), so the sync never deploys a broken workflow.
   */
  needsConfiguration: Array<{ workflowName: string; blocks: string[] }>
  /**
   * Workflows whose OPTIONAL dependent fields a parent change cleared (e.g. a trigger
   * label filter). Redeployed as-is, but surfaced so a cleared filter that would broaden
   * behavior is never silent.
   */
  clearedOptional: Array<{ workflowName: string; blocks: string[] }>
}

function collectCredentialPairs(plan: ForkPromotePlan): Array<[string, string]> {
  const pairs = new Map<string, string>()
  for (const reference of plan.references) {
    if (reference.kind !== 'credential') continue
    const target = plan.resolver('credential', reference.sourceId)
    if (target) pairs.set(reference.sourceId, target)
  }
  return Array.from(pairs.entries())
}

/**
 * Grant each mapped target credential the same active members its source credential has,
 * intersected with the target workspace's members, so a promoted workflow's collaborators
 * can use the remapped credential. Both sides are validated to actually exist in their
 * workspace first (so a crafted/stale mapping can't drive cross-workspace access), member
 * reads are batched, and inserts are conflict-safe. Side-effect only on `credentialMember`.
 */
async function propagateCredentialAccess(
  tx: DbOrTx,
  params: {
    plan: ForkPromotePlan
    sourceWorkspaceId: string
    targetWorkspaceId: string
    targetMembers: string[]
    now: Date
  }
): Promise<void> {
  const { plan, sourceWorkspaceId, targetWorkspaceId, targetMembers, now } = params
  const credentialPairs = collectCredentialPairs(plan)
  const propagationTargetIds = credentialPairs.map(([, targetCredId]) => targetCredId)
  const propagationSourceIds = credentialPairs.map(([sourceCredId]) => sourceCredId)

  const validTargetCredentialIds = new Set<string>()
  if (propagationTargetIds.length > 0) {
    const validRows = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          inArray(credential.id, propagationTargetIds),
          eq(credential.workspaceId, targetWorkspaceId)
        )
      )
    for (const row of validRows) validTargetCredentialIds.add(row.id)
  }

  const validSourceCredentialIds = new Set<string>()
  if (propagationSourceIds.length > 0) {
    const validRows = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          inArray(credential.id, propagationSourceIds),
          eq(credential.workspaceId, sourceWorkspaceId)
        )
      )
    for (const row of validRows) validSourceCredentialIds.add(row.id)
  }

  const validPairs = credentialPairs.filter(
    ([sourceCredId, targetCredId]) =>
      validSourceCredentialIds.has(sourceCredId) && validTargetCredentialIds.has(targetCredId)
  )
  if (validPairs.length === 0) return

  // Batch all source credentials' active members in one query (instead of one per pair),
  // then build a single insert. `targetMembers` becomes a Set for O(1) membership checks.
  const targetMemberSet = new Set(targetMembers)
  const memberRows = await tx
    .select({
      credentialId: credentialMember.credentialId,
      userId: credentialMember.userId,
      role: credentialMember.role,
    })
    .from(credentialMember)
    .where(
      and(
        inArray(
          credentialMember.credentialId,
          validPairs.map(([sourceCredId]) => sourceCredId)
        ),
        eq(credentialMember.status, 'active')
      )
    )
  const membersBySource = new Map<
    string,
    Array<Pick<(typeof memberRows)[number], 'userId' | 'role'>>
  >()
  for (const row of memberRows) {
    if (!targetMemberSet.has(row.userId)) continue
    const list = membersBySource.get(row.credentialId)
    if (list) list.push({ userId: row.userId, role: row.role })
    else membersBySource.set(row.credentialId, [{ userId: row.userId, role: row.role }])
  }
  const memberInserts = validPairs.flatMap(([sourceCredId, targetCredId]) =>
    (membersBySource.get(sourceCredId) ?? []).map((member) => ({
      id: generateId(),
      credentialId: targetCredId,
      userId: member.userId,
      role: member.role,
      status: 'active' as const,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  if (memberInserts.length > 0) {
    await tx
      .insert(credentialMember)
      .values(memberInserts)
      .onConflictDoNothing({
        target: [credentialMember.credentialId, credentialMember.userId],
      })
  }
}

type PromoteTxBlocked =
  | { blocked: 'unmapped'; unmappedRequired: PromoteForkResult['unmappedRequired'] }
  | { blocked: 'cleared-refs'; blockers: ForkSyncBlocker[] }

interface PromoteTxApplied {
  blocked: null
  promoteRunId: string
  deployTargetIds: string[]
  /** Actual written/archived counts (post-skip), not the pre-copy plan totals. */
  updated: number
  created: number
  archived: number
  /** Source workflows skipped because their deployment vanished between plan and apply. */
  skippedItems: Array<{ id: string; name: string }>
  /** Target workflow id -> source name, so the deploy-failure report can show names. */
  writtenNames: Record<string, string>
  /** Names of the changed workflows, by action, for the activity report. */
  updatedNames: string[]
  createdNames: string[]
  archivedNames: string[]
  /** Outbox event ids enqueued for archived orphans' undeploy side-effects. */
  undeployEventIds: string[]
  /**
   * Per-target required dependents a parent change cleared (with workflow id so the
   * post-commit deploy loop can skip them, keeping the prior version running).
   */
  needsConfiguration: Array<{ workflowId: string; workflowName: string; blocks: string[] }>
  /** Per-workflow optional dependents a parent change cleared (surfaced, not gated). */
  clearedOptional: Array<{ workflowName: string; blocks: string[] }>
  /** Heavy content for resources copied into the target this sync, filled best-effort post-commit. */
  copyContentPlan: ForkContentPlan | null
  /** Serialized in-content maps for the post-commit skill-body rewrite (paired with the plan). */
  copyContentRefMaps: SerializableForkContentRefMaps | null
  /** File blob duplications for copied workspace files, run post-commit by the content-copy runner. */
  copyContentBlobTasks: BlobCopyTask[]
  /** Workflow-publishing MCP servers whose tool attachments changed, notified post-commit. */
  mcpAttachmentServerIds: string[]
}

/**
 * Group flat dependent values into the apply map `target workflow -> block id -> subblock -> value`
 * that {@link copyWorkflowStateIntoTarget} consumes. Pure (no DB). Built inside the tx from the
 * TRANSLATED values (see {@link translateForkDependentValues}) once the post-copy resolver exists.
 */
function groupDependentOverrides(
  values: ForkDependentValue[]
): Map<string, Map<string, Map<string, string>>> {
  const byWorkflow = new Map<string, Map<string, Map<string, string>>>()
  for (const entry of values) {
    let byBlock = byWorkflow.get(entry.targetWorkflowId)
    if (!byBlock) {
      byBlock = new Map()
      byWorkflow.set(entry.targetWorkflowId, byBlock)
    }
    let byKey = byBlock.get(entry.targetBlockId)
    if (!byKey) {
      byKey = new Map()
      byBlock.set(entry.targetBlockId, byKey)
    }
    byKey.set(entry.subBlockKey, entry.value)
  }
  return byWorkflow
}

/**
 * Execute a force promote along the edge. Only the source's deployed workflows
 * participate: each one's active deployed state is remapped into the target
 * (replacing mapped targets in place with deterministic block ids, creating new
 * ones, archiving previously-mapped orphans whose source is no longer deployed),
 * a version-reference rollback snapshot is captured, credential access is
 * propagated, and every promoted target is deployed. The plan is computed inside
 * the edge lock so concurrent promotes serialize. A sync always force-replaces the
 * target's deployed state (the modal confirms the overwrite up front); it blocks
 * without mutating when required references (credentials / secrets) are unmapped OR
 * when any reference would clear in a synced target workflow (the zero-cleared-refs
 * gate - every reference must be mapped, selected for copy, or carried by the sync).
 */
export async function promoteFork(params: PromoteForkParams): Promise<PromoteForkResult> {
  const { edge, sourceWorkspaceId, targetWorkspaceId, direction, userId } = params
  const requestId = params.requestId ?? 'unknown'

  // Distinguish an OMITTED dependent mapping (leave the store as-is) from an explicit empty
  // array (clear it). Provided values are normalized to the store row shape here - BEFORE the
  // transaction (pure in-memory, no DB) - mirroring how the source states are pre-loaded above.
  // The apply map itself is built inside the tx: its values are translated through the
  // post-copy resolver (a source document id picked under a copy-resolved KB must land as the
  // copied counterpart), which only exists once the copy has run. The OMITTED path loads the
  // store rows inside the tx too, where the plan's targets are known.
  const dependentValuesProvided = params.dependentValues !== undefined
  const providedDependentValues: ForkDependentValue[] | null = dependentValuesProvided
    ? (params.dependentValues ?? []).map((entry) => ({
        targetWorkflowId: entry.workflowId,
        targetBlockId: entry.blockId,
        subBlockKey: entry.subBlockKey,
        value: entry.value,
      }))
    : null

  // Copied blob bytes (selected workspace files + selected KBs' document blobs) are
  // charged to the initiating user's storage scope exactly as if uploaded to the target
  // workspace, so enforce headroom BEFORE the locked write transaction. The sums scope to
  // the source workspace with the same filters the in-tx copy applies, so a requested id
  // that is not actually copyable (stale/crafted) can only over-count and block - the
  // validated in-tx selection is always a subset. Over quota fails the sync here with the
  // upload path's error shape, before any lock or write.
  const requestedCopyBytes = await sumForkCopyBytes(db, sourceWorkspaceId, {
    fileKeys: params.copyResources?.files,
    knowledgeBaseIds: params.copyResources?.knowledgeBases,
  })
  await assertForkStorageHeadroom({ userId, bytes: requestedCopyBytes })

  const targetMembers = (await getUsersWithPermissions(targetWorkspaceId)).map((m) => m.userId)

  // The target workspace's display name seeds carried chat identifiers
  // (`{target-workspace}-{workflow}-{randomnum}`); read pre-tx like the other lookups.
  const [targetWorkspaceRow] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, targetWorkspaceId))
    .limit(1)
  const targetWorkspaceName = targetWorkspaceRow?.name ?? 'workspace'

  // Read the source's deployed workflows + states BEFORE the transaction so these
  // heavy per-workflow reads never check out a second pooled connection from inside
  // the promote tx (which can deadlock the pool at saturation). The source is
  // read-only here, so this pre-tx snapshot is exactly what gets force-pushed.
  const { deployedWorkflows, sourceStates } = await loadSourceDeployedStates(sourceWorkspaceId)

  const txResult: PromoteTxBlocked | PromoteTxApplied = await db.transaction(async (tx) => {
    // Bound lock waits so a contended sync into this target fails fast instead of
    // stagnating the pool. Must run before acquiring the advisory locks below.
    await setForkLockTimeout(tx)
    // Target lock before edge lock (consistent ordering): the target lock serializes
    // every sync into this target so sibling forks can't interleave writes, and so
    // rollback's "newest sync" check stays race-free against a concurrent promote.
    await acquireForkTargetLock(tx, targetWorkspaceId)
    await acquireForkEdgeLock(tx, edge.childWorkspaceId)

    const plan = await computeForkPromotePlan({
      executor: tx,
      edge,
      sourceWorkspaceId,
      targetWorkspaceId,
      direction,
      deployedSourceWorkflows: deployedWorkflows,
      sourceStates,
    })

    const now = new Date()

    // Copy the selected unmapped resources (referenced and unreferenced) into the target BEFORE
    // the gate, so a user can copy rather than map each one. The gate is evaluated against the
    // post-copy state (the copy resolves the selected refs), so the copy only runs when the sync
    // will actually proceed - if required refs remain unmapped, we block without copying anything.
    const { selection: copySelection, willResolve } = buildPromoteCopySelection(
      params.copyResources,
      plan.copyableUnmapped
    )
    // plan.unmappedRequired is already references.filter(resolver == null).filter(required), so
    // subtracting the refs the copy will resolve is equivalent to re-scanning the predicate.
    const postCopyUnmappedRequired = plan.unmappedRequired.filter(
      (reference) => !willResolve.has(`${reference.kind}:${reference.sourceId}`)
    )
    if (postCopyUnmappedRequired.length > 0) {
      return {
        blocked: 'unmapped',
        unmappedRequired: postCopyUnmappedRequired.map((reference) => ({
          kind: reference.kind,
          sourceId: reference.sourceId,
          required: reference.required,
          blockName: reference.blockName,
        })),
      }
    }

    // Resolve each source block to its counterpart's EXISTING id (via the persisted block
    // map) instead of re-deriving, so a push keeps the parent's original block ids - and the
    // webhook URLs derived from them - stable. Falls back to derive for blocks with no pair
    // yet (added since the last sync). Loaded here (read-only) so the would-clear gate below
    // and the write loop share one block map.
    const sourceIsParent = sourceWorkspaceId === edge.parentWorkspaceId
    const blockMap = await loadForkBlockMap(tx, edge.childWorkspaceId)
    const resolveBlockId = buildForkBlockIdResolver(sourceIsParent, blockMap)

    // Zero-cleared-refs gate: the sync proceeds only when NO reference would clear in any
    // synced target workflow (source fully operational -> target fully operational). Evaluated
    // against the plan resolver overlaid with the validated copy selection (a selected copy
    // resolves its references), BEFORE any write. Authoritative versus the diff's unlocked
    // preview - state drift between preview and Sync re-blocks here (TOCTOU) - and it makes the
    // in-tx remap's clear-unresolved behavior an unreachable defense-in-depth backstop. The
    // plan's unmapped references are threaded through so the gate's happy path reuses the plan's
    // scan (computed moments earlier over the same states, inside this same locked tx) instead of
    // re-running the full per-block reference scan; the scan re-runs only when something blocks.
    const gateResolver: ForkReferenceResolver = (kind, sourceId) =>
      willResolve.has(`${kind}:${sourceId}`) ? sourceId : plan.resolver(kind, sourceId)
    const blockers = await collectForkSyncBlockers({
      executor: tx,
      sourceWorkspaceId,
      items: plan.items,
      sourceStates,
      resolver: gateResolver,
      workflowIdMap: plan.workflowIdMap,
      resolveBlockId,
      planUnmapped: [...plan.unmappedRequired, ...plan.unmappedOptional],
    })
    if (blockers.length > 0) {
      return { blocked: 'cleared-refs', blockers }
    }

    // Resolve the source->target folder map BEFORE the copy so the folders already exist in the
    // target and the copy can rewrite `sim:folder/<id>` references inside copied skill / markdown
    // bodies (the post-commit content rewrite reads this map). Idempotent: it reuses target
    // folders that already match by name within the same mapped parent. Creation is scoped to
    // the folders that will hold a synced workflow (plus ancestors) - a folder whose subtree
    // syncs nothing is never created empty in the target, though it still maps onto a matching
    // existing target folder so prior syncs' refs keep resolving.
    const folderIdMap = await resolveForkFolderMapping({
      tx,
      sourceWorkspaceId,
      targetWorkspaceId,
      userId,
      now,
      contentFolderIds: plan.items.map((item) => item.sourceMeta.folderId),
    })

    let resolver = plan.resolver
    let copyContentPlan: ForkContentPlan | null = null
    let copyContentRefMaps: SerializableForkContentRefMaps | null = null
    let copyContentBlobTasks: BlobCopyTask[] = []
    // Every dependent value this sync will apply, as flat store rows: the provided payload, or
    // (omitted) the persisted store for the plan's targets - loaded here, BEFORE the copy, so
    // document picks can join the copy's discovery set below. The apply map + reconcile further
    // down consume these after translating them through the post-copy resolver.
    const flatDependentValues =
      providedDependentValues ??
      (await loadForkDependentValues(
        tx,
        edge.childWorkspaceId,
        plan.items.map((item) => item.targetWorkflowId)
      ))

    // Knowledge-document ids the synced workflows reference, from the plan's already-scanned
    // references (never a re-scan inside this locked tx) - UNIONED with the dependent-value
    // picks: a document re-picked in the sync page's reconfigure selector under a copy-resolved
    // KB isn't referenced by the source STATE, but must still be copied so the applied pick
    // resolves in the target. Non-document values ride along harmlessly: every consumer filters
    // candidates through `inArray(document.id, ...)`, so a label or column id matches no row.
    const referencedDocumentIds = [
      ...new Set([
        ...plan.references
          .filter((reference) => reference.kind === 'knowledge-document')
          .map((reference) => reference.sourceId),
        ...flatDependentValues.map((entry) => entry.value).filter((value) => value !== ''),
      ]),
    ]
    // Run the copy when the user selected resources to copy OR any document is referenced (a
    // referenced document under an already-mapped KB is auto-copied into that KB so its reference
    // remaps instead of clearing). It runs only after the required-reference gate above, so a
    // blocked sync copies nothing.
    let copyIdMapByKind: Map<ForkRemapKind, Map<string, string>> | null = null
    if (hasPromoteCopySelection(copySelection) || referencedDocumentIds.length > 0) {
      const copyResult = await copyPromoteUnmappedResources({
        tx,
        edge,
        sourceWorkspaceId,
        targetWorkspaceId,
        direction,
        userId,
        now,
        selection: copySelection,
        workflowIdMap: plan.workflowIdMap,
        folderIdMap,
        resolver: plan.resolver,
        // The block map loaded above backs this resolver; copied tables' workflow-group
        // outputs must land on the same target block ids the workflow writes below assign.
        resolveBlockId,
        referencedDocumentIds,
      })
      resolver = augmentForkResolver(plan.resolver, copyResult.copyIdMapByKind)
      copyIdMapByKind = copyResult.copyIdMapByKind
      copyContentPlan = copyResult.contentPlan
      copyContentRefMaps = copyResult.contentRefMaps
      copyContentBlobTasks = copyResult.blobTasks
    }

    // Target rows for the MAPPED (or just-copied) MCP servers this sync references, so remapped
    // tool-input entries rewrite their embedded `serverUrl`/`serverName` from the target server
    // instead of carrying the source's (which would show a false "URL changed" stale badge in
    // the target UI). Bounded: the plan's references are deduped per (kind, id), so this is one
    // `inArray` read over the distinct referenced servers. Uses the post-copy resolver, so a
    // server copied this sync resolves to its fresh row (same name/url - the rewrite is a no-op).
    const mappedMcpServerTargetIds = [
      ...new Set(
        plan.references
          .filter((reference) => reference.kind === 'mcp-server')
          .map((reference) => resolver('mcp-server', reference.sourceId))
          .filter((targetId): targetId is string => targetId != null)
      ),
    ]
    const mcpServerMetaById = await getMcpServerMetaByIds(
      tx,
      targetWorkspaceId,
      mappedMcpServerTargetIds
    )

    const transform = createForkSubBlockTransform(resolver, {
      resolveMcpServerMeta: (targetServerId) => mcpServerMetaById.get(targetServerId),
      // Copy provenance: a parent resolved through THIS sync's copy selection keeps its
      // copy-faithful dependents (a copied table's column picks) instead of clearing them.
      isCopiedTarget: (kind, sourceId) => copyIdMapByKind?.get(kind)?.has(sourceId) ?? false,
    })

    // Batch every prior-version read (replace + archive targets) into one query before any
    // write, so the locked apply phase doesn't do N round-trips. Reads are pre-write, so
    // they still reflect the active version each target had before this sync.
    const priorVersionByTarget = await getActiveDeploymentVersionNumbers(tx, [
      ...plan.items.filter((item) => item.mode === 'replace').map((item) => item.targetWorkflowId),
      ...plan.archivedTargetIds,
    ])

    // Preload the target's active workflow names so per-workflow collision checks read from
    // memory instead of one query each inside this locked tx. The DB unique index remains
    // the correctness backstop (a stale snapshot only risks a rare, retry-able conflict).
    const nameRegistry = await loadWorkflowNameRegistry(tx, targetWorkspaceId)

    // Replace targets (the only mode with a prior target state) - reused by the draft preload
    // and the dependent-value apply/load below.
    const replaceTargetIds = plan.items
      .filter((item) => item.mode === 'replace')
      .map((item) => item.targetWorkflowId)

    // Preload the target's current draft subBlocks (replace targets only) so the copy can
    // detect dependent fields a parent change cleared that the stored mapping didn't refill
    // (surfaced as needs-configuration). One batched query pre-write, so it reflects the
    // pre-sync target state.
    const targetDraftByWorkflow = await loadTargetDraftSubBlocks(tx, replaceTargetIds)

    // The dependent-value apply map (target workflow -> block id -> subblock -> value), built
    // from the flat values loaded above (the provided payload, or - omitted - the stored
    // mapping, which stays the sole source of truth; the reconcile below is skipped then so an
    // omitted field never wipes it). Values are translated through the post-copy resolver
    // FIRST: the apply runs AFTER the reference remap inside `copyWorkflowStateIntoTarget` and
    // wins for its subblock, so a SOURCE document id picked under a copy-resolved KB must
    // become the copied counterpart here - otherwise the stale source id would clobber the
    // remapped value in the written state. Create targets are included: a value pre-configured
    // for a never-synced workflow (keyed by its deterministic target id) applies on the first
    // sync that creates it.
    const appliedDependentValues = translateForkDependentValues(flatDependentValues, resolver)
    const overridesByWorkflow = groupDependentOverrides(appliedDependentValues)

    // New block pairs recorded by the write loop (blocks added since the last sync), using the
    // block map + resolver loaded before the would-clear gate above.
    const blockPairs: ForkBlockPair[] = []

    const updatedSnapshots: PromoteRunWorkflowSnapshot[] = []
    const createdTargetIds: string[] = []
    const writtenItems: typeof plan.items = []
    const needsConfiguration: PromoteTxApplied['needsConfiguration'] = []
    const clearedOptional: PromoteTxApplied['clearedOptional'] = []
    for (const item of plan.items) {
      // Use the pre-read source state (loaded above, before the tx). An item only
      // exists when its state was present at read time, so this lookup hits; the
      // guard stays as defense so the written counts below never over-report.
      const sourceState = sourceStates.get(item.sourceWorkflowId)
      if (!sourceState) continue
      if (item.mode === 'replace') {
        const priorVersion = priorVersionByTarget.get(item.targetWorkflowId) ?? null
        updatedSnapshots.push({ workflowId: item.targetWorkflowId, priorVersion })
      } else {
        createdTargetIds.push(item.targetWorkflowId)
      }
      const copyResult = await copyWorkflowStateIntoTarget({
        tx,
        targetWorkflowId: item.targetWorkflowId,
        targetWorkspaceId,
        userId,
        mode: item.mode,
        now,
        sourceState,
        sourceMeta: item.sourceMeta,
        workflowIdMap: plan.workflowIdMap,
        folderIdMap,
        transformSubBlocks: transform,
        targetCurrentBlocks:
          item.mode === 'replace' ? targetDraftByWorkflow.get(item.targetWorkflowId) : undefined,
        dependentOverrides: overridesByWorkflow.get(item.targetWorkflowId),
        nameRegistry,
        resolveBlockId,
        requestId,
      })
      blockPairs.push(
        ...toForkBlockPairs(
          copyResult.blockIdMapping,
          sourceIsParent,
          item.sourceWorkflowId,
          item.targetWorkflowId
        )
      )
      const requiredCleared = copyResult.clearedDependents.filter((field) => field.required)
      const optionalCleared = copyResult.clearedDependents.filter((field) => !field.required)
      if (requiredCleared.length > 0) {
        needsConfiguration.push({
          workflowId: item.targetWorkflowId,
          workflowName: item.sourceMeta.name,
          // Surface the block names (deduped) - the field titles ("Label") aren't useful.
          blocks: [...new Set(requiredCleared.map((field) => field.blockName))],
        })
      }
      if (optionalCleared.length > 0) {
        clearedOptional.push({
          workflowName: item.sourceMeta.name,
          blocks: [...new Set(optionalCleared.map((field) => field.blockName))],
        })
      }
      writtenItems.push(item)
    }

    // Reconcile block-identity pairs for the written source workflows: clears pairs for
    // blocks the source dropped (e.g. a deleted trigger) and any stale pair from a re-created
    // target, then records the live ones - so the next promote resolves these blocks to these
    // same ids and never re-homes one onto an archived workflow's block.
    await reconcileForkBlockPairs(
      tx,
      edge.childWorkspaceId,
      sourceIsParent,
      writtenItems.map((item) => item.sourceWorkflowId),
      blockPairs
    )

    // Carry chat deployments for written targets that have NO chat row yet (typically
    // create-mode targets): a fresh `{target-workspace}-{workflow}-{randomnum}` identifier with
    // the source's config, live once this sync's deploy lands. Targets with any existing chat
    // (live or archived) are left untouched - an earlier carry-over keeps its URL on every
    // subsequent sync, and a deliberately archived chat is never resurrected. Targets whose
    // redeploy this sync SKIPS (required dependents cleared) are excluded: their chat would
    // squat a live identifier while nothing can serve - the next successful sync carries it.
    const needsConfigurationTargetIds = new Set(needsConfiguration.map((entry) => entry.workflowId))
    await copyForkChatDeployments({
      tx,
      pairs: writtenItems.flatMap((item) =>
        needsConfigurationTargetIds.has(item.targetWorkflowId)
          ? []
          : [
              {
                sourceWorkflowId: item.sourceWorkflowId,
                targetWorkflowId: item.targetWorkflowId,
                workflowName: item.sourceMeta.name,
              },
            ]
      ),
      targetWorkspaceName,
      userId,
      now,
      resolveBlockId,
      requestId,
    })

    // Mirror workflow-as-MCP-tool attachments onto MAPPED workflow-publishing servers for the
    // written pairs: missing target attachments are created, drifted metadata refreshed, and a
    // detached source's counterpart archived. The deployment outbox re-derives each affected
    // tool's parameter schema when the target deploys below.
    const mcpAttachmentResult = await reconcileForkWorkflowMcpAttachments({
      tx,
      childWorkspaceId: edge.childWorkspaceId,
      sourceIsParent,
      now,
      writtenPairs: writtenItems.map((item) => ({
        sourceWorkflowId: item.sourceWorkflowId,
        targetWorkflowId: item.targetWorkflowId,
      })),
    })

    // Persist / prune the stored dependent mapping. When the caller PROVIDED values, replace
    // every written target's stored set (cleared/removed fields drop out so the store equals
    // exactly what was applied) AND prune the archived targets' now-dead rows (their workflow
    // no longer exists and has no FK to cascade). The TRANSLATED values are persisted - a
    // source document id picked under a copy-resolved KB is stored as its copied counterpart,
    // so the next sync (whose parent is then MAPPED via the persisted copy mapping) pre-fills
    // a value that resolves in the target. Written CREATE targets persist too - they exist
    // as of this sync, and their sent values (pre-configured in the mapping editor or the
    // modal) must survive as the stored mapping for future syncs. Scope the inserted values
    // to the delete's workflows so a value for a workflow skipped this pass (its source state
    // vanished) can't be inserted without first clearing its old row and trip the unique
    // constraint. When OMITTED, the store stays the source of truth (already applied above) -
    // only prune archived targets, never touch the live targets' mapping.
    const dependentTargetIds = new Set(writtenItems.map((item) => item.targetWorkflowId))
    if (dependentValuesProvided) {
      await reconcileForkDependentValues(
        tx,
        edge.childWorkspaceId,
        [...dependentTargetIds, ...plan.archivedTargetIds],
        appliedDependentValues.filter((entry) => dependentTargetIds.has(entry.targetWorkflowId))
      )
    } else if (plan.archivedTargetIds.length > 0) {
      await reconcileForkDependentValues(tx, edge.childWorkspaceId, plan.archivedTargetIds, [])
    }

    const archivedNames =
      plan.archivedTargetIds.length > 0
        ? (
            await tx
              .select({ name: workflow.name })
              .from(workflow)
              .where(inArray(workflow.id, plan.archivedTargetIds))
          ).map((row) => row.name)
        : []

    const undeployEventIds: string[] = []
    const archivedSnapshots: PromoteRunWorkflowSnapshot[] = []
    for (const targetWorkflowId of plan.archivedTargetIds) {
      const priorVersion = priorVersionByTarget.get(targetWorkflowId) ?? null
      archivedSnapshots.push({ workflowId: targetWorkflowId, priorVersion })
      // Enqueue undeploy side-effects (webhook + MCP-tool cleanup) so an archived orphan
      // doesn't leak its subscriptions/registrations - mirrors rollback's undeploy path.
      await undeployWorkflow({
        workflowId: targetWorkflowId,
        tx,
        onUndeployTransaction: async (innerTx, { deploymentVersionIds }) => {
          if (deploymentVersionIds.length === 0) return
          const eventId = await enqueueWorkflowUndeploySideEffects(innerTx, {
            workflowId: targetWorkflowId,
            deploymentVersionIds,
            userId,
            requestId,
          })
          undeployEventIds.push(eventId)
        },
      })
      await tx
        .update(workflow)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(workflow.id, targetWorkflowId))
    }
    // Archive the archived targets' chat deployments too (matching `archiveWorkflow`): a live
    // chat row would keep squatting its unique identifier and serving a dead workflow. The
    // undeploy side-effects above cover webhooks + MCP tools; chats have no undeploy hook.
    if (plan.archivedTargetIds.length > 0) {
      await tx
        .update(chat)
        .set({ archivedAt: now, isActive: false, updatedAt: now })
        .where(and(inArray(chat.workflowId, plan.archivedTargetIds), isNull(chat.archivedAt)))
    }

    const identityEntries: ForkMappingUpsert[] = writtenItems.map((item) => ({
      resourceType: 'workflow' as const,
      parentResourceId: direction === 'pull' ? item.sourceWorkflowId : item.targetWorkflowId,
      childResourceId: direction === 'pull' ? item.targetWorkflowId : item.sourceWorkflowId,
    }))
    // The identity upsert keys on the parent side, which on push is the TARGET. A
    // source whose previously-mapped target was archived gets a freshly-generated
    // target id here, so its old (stale-target) identity row wouldn't be overwritten
    // and would leak a second mapping for the same source. Delete every prior identity
    // row for these sources (by the source side) first so exactly one row per source
    // remains - this also converges any pre-existing duplicates.
    await deleteWorkflowIdentityByIds(
      tx,
      edge.childWorkspaceId,
      direction === 'pull' ? 'parent' : 'child',
      writtenItems.map((item) => item.sourceWorkflowId)
    )
    await upsertEdgeMappings(tx, edge.childWorkspaceId, userId, identityEntries)

    await propagateCredentialAccess(tx, {
      plan,
      sourceWorkspaceId,
      targetWorkspaceId,
      targetMembers,
      now,
    })

    const promoteRunId = await upsertPromoteRun(tx, {
      childWorkspaceId: edge.childWorkspaceId,
      sourceWorkspaceId,
      targetWorkspaceId,
      direction,
      userId,
      snapshot: {
        updated: updatedSnapshots,
        created: createdTargetIds,
        archived: archivedSnapshots,
      },
    })

    // A source whose active deployment vanished between plan and copy is skipped
    // above, so report what was actually written - the plan totals would overstate.
    const writtenSourceIds = new Set(writtenItems.map((item) => item.sourceWorkflowId))
    const skippedItems = plan.items
      .filter((item) => !writtenSourceIds.has(item.sourceWorkflowId))
      .map((item) => ({ id: item.sourceWorkflowId, name: item.sourceMeta.name }))
    if (skippedItems.length > 0) {
      logger.warn(
        `[${requestId}] Promote skipped ${skippedItems.length} source workflow(s) whose deployment disappeared between plan and apply`,
        { sourceWorkspaceId, targetWorkspaceId, skipped: skippedItems.length }
      )
    }

    return {
      blocked: null,
      promoteRunId,
      deployTargetIds: writtenItems.map((item) => item.targetWorkflowId),
      updated: updatedSnapshots.length,
      created: createdTargetIds.length,
      archived: archivedSnapshots.length,
      skippedItems,
      writtenNames: Object.fromEntries(
        writtenItems.map((item) => [item.targetWorkflowId, item.sourceMeta.name])
      ),
      updatedNames: writtenItems
        .filter((item) => item.mode === 'replace')
        .map((item) => item.sourceMeta.name),
      createdNames: writtenItems
        .filter((item) => item.mode !== 'replace')
        .map((item) => item.sourceMeta.name),
      archivedNames,
      undeployEventIds,
      needsConfiguration,
      clearedOptional,
      copyContentPlan,
      copyContentRefMaps,
      copyContentBlobTasks,
      mcpAttachmentServerIds: mcpAttachmentResult.affectedServerIds,
    }
  })

  if (txResult.blocked !== null) {
    return {
      promoteRunId: '',
      updated: 0,
      created: 0,
      archived: 0,
      redeployed: 0,
      deployFailed: 0,
      unmappedRequired: txResult.blocked === 'unmapped' ? txResult.unmappedRequired : [],
      blockers: txResult.blocked === 'cleared-refs' ? txResult.blockers : [],
      blocked: txResult.blocked,
      updatedNames: [],
      createdNames: [],
      archivedNames: [],
      needsConfiguration: [],
      clearedOptional: [],
    }
  }

  // Process archived orphans' undeploy side-effects after commit (durably retried by the
  // outbox cron if this dies first), so the locked transaction never held a network call.
  for (const eventId of txResult.undeployEventIds) {
    try {
      await processWorkflowDeploymentOutboxEvent(eventId)
    } catch (error) {
      logger.warn(`[${requestId}] Deferred archive undeploy side-effect failed (will retry)`, {
        eventId,
        error: getErrorMessage(error),
      })
    }
  }

  // Post-commit only: tell the affected workflow-publishing MCP servers their tool set changed
  // (the deploy loop's outbox covers deployed targets; archived-attachment servers need this).
  if (txResult.mcpAttachmentServerIds.length > 0) {
    notifyMcpToolServers(txResult.mcpAttachmentServerIds.map((serverId) => ({ serverId })))
  }

  let redeployed = 0
  const deployFailures: string[] = []
  const deployWarnings: string[] = []
  // Targets whose required dependents a parent change cleared: their draft holds the
  // synced state, but we intentionally skip the redeploy so the prior deployed version
  // keeps running instead of going live with an empty required field. The user re-picks
  // the field (surfaced via `needsConfiguration`), then a redeploy/next sync deploys it.
  const needsConfigTargetIds = new Set(txResult.needsConfiguration.map((n) => n.workflowId))
  // Deploy in a deterministic (sorted) order so this UNLOCKED loop acquires workflow
  // row locks in the same order as a concurrent rollback's atomic tx (and a sibling
  // promote's deploy loop), avoiding deadlocks - see rollback.ts lock ordering.
  const deployTargetIds = [...txResult.deployTargetIds].sort((a, b) => a.localeCompare(b))
  for (const targetWorkflowId of deployTargetIds) {
    // The transaction already force-replaced this target's draft state, so connected
    // canvas clients must adopt it (mothership-edit semantics) whether or not the
    // subsequent deploy succeeds - otherwise they keep, and may clobber, stale state.
    void notifyForkWorkflowChanged(targetWorkflowId)
    if (needsConfigTargetIds.has(targetWorkflowId)) continue
    try {
      const result = await performFullDeploy({ workflowId: targetWorkflowId, userId, requestId })
      if (result.success) {
        redeployed += 1
        // A deploy can succeed but defer/queue some side-effects (trigger/schedule/MCP
        // sync). Surface those instead of swallowing them into a clean success.
        if (result.warnings?.length) {
          const name = txResult.writtenNames[targetWorkflowId] ?? targetWorkflowId
          for (const warning of result.warnings) deployWarnings.push(`${name}: ${warning}`)
        }
      } else {
        deployFailures.push(targetWorkflowId)
        logger.warn(`[${requestId}] Deploy after promote failed`, {
          workflowId: targetWorkflowId,
          error: result.error,
        })
      }
    } catch (error) {
      deployFailures.push(targetWorkflowId)
      logger.error(`[${requestId}] Deploy after promote threw`, {
        workflowId: targetWorkflowId,
        error: getErrorMessage(error),
      })
    }
  }

  // Fill the heavy content (table rows, KB documents + embeddings) of resources copied into the
  // target this sync and rewrite copied skill bodies, off the request path. Scheduled AFTER the
  // deploy loop so every deployed version this sync cut already EXISTS: a failed content fill's
  // cleanup sweep unions `deployedTargetWorkflowIds`, so it must not race ahead of those versions.
  // Mirrors fork: a durable status row + Trigger.dev task surfaces a crash as a failed Activity
  // entry rather than a silently-empty placeholder (runDetached is the non-Trigger fallback); the
  // runner also clears references + drops the placeholder for any resource whose fill fails.
  const copyContentPlan = txResult.copyContentPlan
  const copyBlobTasks = txResult.copyContentBlobTasks
  const hasCopyContent =
    copyContentPlan != null && hasForkContentToCopy(copyContentPlan, copyBlobTasks)
  if (copyContentPlan && hasCopyContent) {
    // Scope the durable record to the workspace whose Manage Forks -> Activity the user is
    // viewing (the one the sync was initiated from), matching where the route records the sync.
    const activityWorkspaceId = direction === 'push' ? sourceWorkspaceId : targetWorkspaceId
    // The sync already committed; failing to record the tracking row must not turn it into a 500.
    // The runner no-ops its status updates when statusId is absent, so the copy still runs.
    let statusId: string | undefined
    try {
      statusId = await startBackgroundWork(db, {
        workspaceId: activityWorkspaceId,
        kind: 'fork_content_copy',
        // Append-only: each sync's content fill is a distinct entry in the Activity history.
        supersede: false,
        message: 'Copying synced resources',
        metadata: {
          // The edge's other side, so the partner workspace's Activity surfaces this row too.
          otherWorkspaceId: direction === 'push' ? targetWorkspaceId : sourceWorkspaceId,
          // The content fill runs as a background worker with no session; the Activity
          // actor is the user who initiated the sync, not "System".
          actorName: params.actorName,
          tables: copyContentPlan.tables.length,
          knowledgeBases: copyContentPlan.knowledgeBases.length,
          files: copyBlobTasks.length,
        },
      })
    } catch (error) {
      logger.error(`[${requestId}] Failed to record sync content-copy status`, {
        targetWorkspaceId,
        error: getErrorMessage(error),
      })
    }

    const payload: ForkContentCopyPayload = {
      contentPlan: copyContentPlan,
      blobTasks: copyBlobTasks,
      contentRefMaps: txResult.copyContentRefMaps ?? undefined,
      statusId,
      // The targets this sync wrote and deployed above, so a failed content fill can sweep the
      // dropped placeholder from their DEPLOYED version states too, not just drafts.
      deployedTargetWorkflowIds: txResult.deployTargetIds,
      requestId,
    }
    await scheduleForkContentCopy(payload, { detachedLabel: 'fork-sync-content-copy', requestId })
  }

  if (deployFailures.length > 0) {
    logger.warn(`[${requestId}] Promote wrote state but some targets failed to deploy`, {
      sourceWorkspaceId,
      targetWorkspaceId,
      deployFailed: deployFailures.length,
      deployFailures,
    })
  }

  if (deployWarnings.length > 0) {
    logger.warn(`[${requestId}] Promote deploys emitted warnings`, { deployWarnings })
  }
  if (txResult.skippedItems.length > 0) {
    logger.warn(`[${requestId}] Promote skipped undeployed source workflows`, {
      skipped: txResult.skippedItems.map((item) => item.name),
    })
  }
  if (txResult.needsConfiguration.length > 0) {
    logger.warn(`[${requestId}] Promote left required dependent fields needing configuration`, {
      sourceWorkspaceId,
      targetWorkspaceId,
      needsConfiguration: txResult.needsConfiguration.map((n) => n.workflowName),
    })
  }
  logger.info(`[${requestId}] Promoted ${sourceWorkspaceId} -> ${targetWorkspaceId}`, {
    updated: txResult.updated,
    created: txResult.created,
    archived: txResult.archived,
    redeployed,
    deployFailed: deployFailures.length,
    needsConfiguration: txResult.needsConfiguration.length,
  })

  return {
    promoteRunId: txResult.promoteRunId,
    updated: txResult.updated,
    created: txResult.created,
    archived: txResult.archived,
    redeployed,
    deployFailed: deployFailures.length,
    unmappedRequired: [],
    blockers: [],
    blocked: null,
    updatedNames: txResult.updatedNames,
    createdNames: txResult.createdNames,
    archivedNames: txResult.archivedNames,
    needsConfiguration: txResult.needsConfiguration.map(({ workflowName, blocks }) => ({
      workflowName,
      blocks,
    })),
    clearedOptional: txResult.clearedOptional,
  }
}
