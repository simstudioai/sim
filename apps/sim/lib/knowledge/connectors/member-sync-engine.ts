import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import {
  type CredentialGroupOptionCredentialReference,
  loadCredentialGroupCredentialListContext,
} from '@/lib/credential-groups/credentials'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { EMPTY_ACL, subjectToken } from '@/lib/knowledge/access/tokens'
import {
  KnowledgeConnectorMemberAccessDeniedError,
  listKnowledgeConnectorMemberCredentials,
  mintKnowledgeConnectorMemberToken,
} from '@/lib/knowledge/connectors/member-access'
import {
  applyMemberDocumentLifecycle,
  listObservedDocumentIds,
  materializeDocumentAcls,
  recordMemberObservations,
  removeMemberObservationsForDocuments,
  removeUnseenMemberObservations,
} from '@/lib/knowledge/connectors/member-observations'
import {
  inviteWorkspaceMembersToCredentialGroup,
  MEMBER_PROVISION_INVITES_PER_RUN,
} from '@/lib/knowledge/connectors/member-provisioning'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  connectorFailureBackoffMinutes,
  MAX_CONSECUTIVE_FAILURES,
  MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES,
  MEMBER_FULL_RECRAWL_MINUTES,
  MEMBER_SUSPENDED_PURGE_DAYS,
  MEMBER_SYNC_MAX_PAGES_PER_MEMBER,
  MEMBER_SYNC_SOFT_BUDGET_SECONDS,
} from '@/lib/knowledge/connectors/sync-limits'
import {
  createMemberSyncLease,
  holdsMemberSyncLockToken,
  SyncLockLostException,
  stillHoldsMemberSyncLock,
} from '@/lib/knowledge/connectors/sync-lock'
import type { KnowledgeBaseOwner } from '@/lib/knowledge/connectors/sync-persistence'
import {
  addSourcePagePayloadBytes,
  ConnectorDeletedException,
  ConnectorSyncCapacityError,
  ConnectorSyncWorkingSetLimitError,
  classifyListing,
  classifySuspectListing,
  createSyncRunState,
  loadOwnedCorpus,
  processDocOps,
  RETRY_WINDOW_DAYS,
  runChangeFeedPass,
  runListingPass,
  sourcePageFitsSyncWorkingSet,
  sweepStuckDocuments,
  syncWorkingSetQueryLimit,
} from '@/lib/knowledge/connectors/sync-primitives'
import { getRetryAfterMs, isRateLimitError } from '@/lib/knowledge/documents/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type {
  ConnectorConfig,
  ExternalDocument,
  SyncResult,
  SyncSkipReason,
} from '@/connectors/types'

const logger = createLogger('ConnectorMemberSyncEngine')

/** Observers tried, in listing order, before a document's hydration is given up on. */
const HYDRATION_OBSERVER_ATTEMPTS = 3
/** A minted token is reused for this long before the member is re-minted. */
const MEMBER_TOKEN_REUSE_MS = 45 * 60 * 1000
/** Overlap subtracted from a member's incremental watermark, covering source clock skew. */
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000
/** Rows rewritten per statement while finishing a mode switch's ACL rewrite. */
const ACCESS_REWRITE_BATCH_SIZE = 1000
/** Member rows read per page while reconciling membership. */
const MEMBER_CREDENTIAL_PAGE_SIZE = 100
/** Backoff ceiling for one member's failure ladder. */
const MEMBER_BACKOFF_CAP_MS = 24 * 60 * 60 * 1000
/** Interval a manual-only connector (interval 0) uses to pace member retries. */
const MEMBER_BACKOFF_BASE_MINUTES = 60

export interface MemberSyncResult extends SyncResult {
  membersClaimed: number
  membersCompleted: number
  membersIncomplete: number
  membersFailed: number
  /** Whether members were still due when the run's budget ended. */
  membersRemaining: boolean
  docsListed: number
  docsHydratedOnce: number
  observationsAdded: number
  observationsRemoved: number
  docsTombstoned: number
  docsResurrected: number
  docsPurged: number
  credentialsAudited: number
}

export interface ExecuteMemberSyncOptions {
  billingAttribution: BillingAttributionSnapshot
  /** The queue entry this run is allowed to consume; see `MemberSyncPayload.dispatchToken`. */
  dispatchToken?: string
}

type MemberRow = typeof knowledgeConnectorMember.$inferSelect

/** One member's credential as the option reports it, with the membership state it implies. */
export interface MemberCredentialSnapshot {
  credentialId: string
  subjectToken: string
  active: boolean
}

/**
 * How a member's view of the source was read this run. A full listing is the
 * only kind that can withdraw access by omission; the change feed withdraws it
 * by an explicit removal; an incremental listing refreshes content only.
 */
type MemberListingMode = 'full' | 'changes' | 'incremental'

/** What one member's listing established for this run. */
interface MemberListingOutcome {
  member: MemberRow
  mode: MemberListingMode
  listingStartedAt: Date
  seenExternalIds: Set<string>
  /** Items the change feed reported as deleted or no longer reachable by the member. */
  removedExternalIds: readonly string[]
  listedCount: number
  complete: boolean
  /**
   * An incomplete listing the next run can pick up where this one stopped —
   * the budget ended, or a feed pass hit its page cap — rather than one a
   * retry cannot improve on, such as a capped or truncated source.
   */
  resumable: boolean
  suspect: boolean
  /** Cursor to store when this outcome lands: a value, null to close the feed, undefined to leave it. */
  changeCursor: string | null | undefined
}

interface UnionEntry {
  document: ExternalDocument
  /** Member ids whose listings returned the document, in listing order. */
  observers: string[]
}

function emptyResult(): MemberSyncResult {
  return {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
    membersClaimed: 0,
    membersCompleted: 0,
    membersIncomplete: 0,
    membersFailed: 0,
    membersRemaining: false,
    docsListed: 0,
    docsHydratedOnce: 0,
    observationsAdded: 0,
    observationsRemoved: 0,
    docsTombstoned: 0,
    docsResurrected: 0,
    docsPurged: 0,
    credentialsAudited: 0,
  }
}

function skipped(result: MemberSyncResult, skipReason: SyncSkipReason): MemberSyncResult {
  return { ...result, skipReason }
}

/**
 * Whether a credential collected under the option currently makes its owner an
 * active member: the credential is usable, the enrollment is live, and the
 * option and group are still active. Anything else suspends the member, which
 * drops their token from every ACL but keeps their observations.
 */
export function deriveMemberActive(
  credential: Pick<
    CredentialGroupOptionCredentialReference,
    'managedOauthStatus' | 'enrollmentStatus'
  >,
  option: { groupActive: boolean; optionActive: boolean }
): boolean {
  return (
    option.groupActive &&
    option.optionActive &&
    credential.managedOauthStatus === 'active' &&
    (credential.enrollmentStatus === 'in_progress' || credential.enrollmentStatus === 'completed')
  )
}

/**
 * Whether a member needs a full listing this run. Without a change feed only a
 * full listing grants or removes access, so every member gets one at least
 * every {@link MEMBER_FULL_RECRAWL_MINUTES} and an incremental listing
 * refreshes content between them. A member whose feed is open needs one only
 * every {@link MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES}, as a check that the
 * feed missed nothing.
 */
export function shouldListFully(
  memberSyncedThrough: Date | null,
  lastCompleteListingAt: Date | null,
  now: Date,
  recrawlMinutes: number = MEMBER_FULL_RECRAWL_MINUTES
): boolean {
  if (!memberSyncedThrough || !lastCompleteListingAt) return true
  return now.getTime() - lastCompleteListingAt.getTime() >= recrawlMinutes * 60 * 1000
}

/** Whether a connector can keep a per-member change feed at all. */
function supportsChangeFeed(
  connectorConfig: ConnectorConfig
): connectorConfig is ConnectorConfig & {
  listChanges: NonNullable<ConnectorConfig['listChanges']>
  getChangeCursor: NonNullable<ConnectorConfig['getChangeCursor']>
} {
  return (
    typeof connectorConfig.listChanges === 'function' &&
    typeof connectorConfig.getChangeCursor === 'function'
  )
}

/** The next attempt for a member whose listing threw: exponential on the connector's interval, capped at a day. */
export function memberFailureBackoffMs(failures: number, syncIntervalMinutes: number): number {
  const baseMinutes = syncIntervalMinutes > 0 ? syncIntervalMinutes : MEMBER_BACKOFF_BASE_MINUTES
  const exponent = Math.min(Math.max(failures, 1) - 1, 20)
  return Math.min(2 ** exponent * baseMinutes * 60 * 1000, MEMBER_BACKOFF_CAP_MS)
}

/**
 * The connector row a failed run writes: the content engine's ladder over the
 * member columns, so a connector that keeps failing per member backs off and
 * eventually disables exactly as a workspace-mode one does.
 */
export function buildMemberSyncFailureUpdate(
  now: Date,
  previousFailures: number | null | undefined,
  errorMessage: string,
  retryAfterMs?: number
) {
  const failures = (previousFailures ?? 0) + 1
  const disabled = failures >= MAX_CONSECUTIVE_FAILURES
  const failureBackoffMs = connectorFailureBackoffMinutes(failures) * 60 * 1000
  const maximumBackoffMs = CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES * 60 * 1000
  const providerBackoffMs =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(retryAfterMs, maximumBackoffMs)
      : 0
  return {
    memberSyncStatus: (disabled ? 'disabled' : 'error') as 'disabled' | 'error',
    lastMemberSyncError: disabled ? CONNECTOR_AUTO_DISABLED_ERROR : errorMessage,
    nextMemberSyncAt: disabled
      ? null
      : new Date(now.getTime() + Math.max(failureBackoffMs, providerBackoffMs)),
    memberSyncConsecutiveFailures: failures,
    memberSyncLockToken: null,
    memberSyncLockLeaseAt: null,
    updatedAt: now,
  }
}

/** The next scheduled run: immediately while members remain due, else the interval plus jitter. */
export function nextMemberSyncTime(
  now: Date,
  syncIntervalMinutes: number,
  membersRemaining: boolean
): Date | null {
  if (membersRemaining) return now
  if (syncIntervalMinutes <= 0) return null
  const jitterMs = randomInt(0, Math.min(syncIntervalMinutes * 6_000, 300_000))
  return new Date(now.getTime() + syncIntervalMinutes * 60_000 + jitterMs)
}

/**
 * Admits one member's listing into the run's union: first writer wins on a
 * repeated external id, every writer is recorded as an observer, and the
 * union is held to the same working-set and payload limits as a single
 * workspace-mode listing.
 */
export function admitMemberListing(
  union: Map<string, UnionEntry>,
  memberId: string,
  documents: readonly ExternalDocument[],
  connectorId: string,
  retainedBytes: number
): { seenExternalIds: Set<string>; retainedBytes: number } {
  const seenExternalIds = new Set<string>()
  const admitted: ExternalDocument[] = []
  for (const doc of documents) {
    if (seenExternalIds.has(doc.externalId)) continue
    seenExternalIds.add(doc.externalId)
    const existing = union.get(doc.externalId)
    if (existing) {
      existing.observers.push(memberId)
      continue
    }
    admitted.push(doc)
  }
  if (!sourcePageFitsSyncWorkingSet(union.size, admitted.length)) {
    throw new ConnectorSyncWorkingSetLimitError(connectorId, 'source listing')
  }
  const nextBytes = addSourcePagePayloadBytes(retainedBytes, admitted)
  for (const doc of admitted) {
    union.set(doc.externalId, { document: doc, observers: [memberId] })
  }
  return { seenExternalIds, retainedBytes: nextBytes }
}

interface MemberSyncRun {
  connectorId: string
  knowledgeBaseId: string
  workspaceId: string
  runId: string
  runStartedAt: Date
  deadlineAt: number
  result: MemberSyncResult
  lease: ReturnType<typeof createMemberSyncLease>
}

/** A token minted for a member, reused within the run until it ages out. */
interface MemberTokenCache {
  get(memberId: string): Promise<string>
}

function createMemberTokenCache(input: {
  run: MemberSyncRun
  connectorConfig: Pick<ConnectorConfig, 'auth'>
  credentialIdByMemberId: Map<string, string>
}): MemberTokenCache {
  const tokens = new Map<string, { accessToken: string; mintedAtMs: number }>()
  const { auth } = input.connectorConfig
  if (auth.mode !== 'oauth') throw new Error('Members mode requires an OAuth connector')
  return {
    async get(memberId) {
      const cached = tokens.get(memberId)
      if (cached && Date.now() - cached.mintedAtMs < MEMBER_TOKEN_REUSE_MS)
        return cached.accessToken
      const credentialId = input.credentialIdByMemberId.get(memberId)
      if (!credentialId) throw new Error(`Member ${memberId} has no credential in this run`)
      const minted = await mintKnowledgeConnectorMemberToken({
        connectorId: input.run.connectorId,
        workspaceId: input.run.workspaceId,
        credentialId,
        expectedProviderId: auth.provider,
        requiredScopes: auth.requiredScopes ?? [],
        runId: input.run.runId,
      })
      input.run.result.credentialsAudited += 1
      tokens.set(memberId, { accessToken: minted.accessToken, mintedAtMs: Date.now() })
      return minted.accessToken
    },
  }
}

async function acquireMemberSyncLock(
  connectorId: string,
  runId: string,
  dispatchToken: string | undefined
): Promise<typeof knowledgeConnector.$inferSelect | null> {
  const now = new Date()
  const [row] = await db
    .update(knowledgeConnector)
    .set({
      memberSyncStatus: 'running',
      memberSyncLockToken: runId,
      memberSyncLockLeaseAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        eq(knowledgeConnector.accessMode, 'members'),
        inArray(knowledgeConnector.memberSyncStatus, ['idle', 'pending', 'error']),
        ...(dispatchToken ? [eq(knowledgeConnector.memberSyncLockToken, dispatchToken)] : []),
        isNull(knowledgeConnector.syncLockToken),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .returning()
  return row ?? null
}

async function insertMemberSyncLog(runId: string, connectorId: string, startedAt: Date) {
  await db.insert(knowledgeConnectorMemberSyncLog).values({
    id: runId,
    connectorId,
    status: 'started',
    startedAt,
  })
}

/**
 * Finishes an ACL rewrite a mode switch left behind before this run lists
 * anything: every document of the connector is hidden until an observation
 * makes it visible again.
 */
async function finishPendingAccessRewrite(run: MemberSyncRun): Promise<void> {
  for (;;) {
    await run.lease.beatIfDue()
    const rewritten = await db
      .update(document)
      .set({ acl: [...EMPTY_ACL] })
      .where(
        and(
          eq(
            document.id,
            sql`ANY(ARRAY(
            SELECT ${document.id} FROM ${document}
            WHERE ${document.connectorId} = ${run.connectorId}
              AND cardinality(${document.acl}) > 0
            LIMIT ${ACCESS_REWRITE_BATCH_SIZE}
          ))`
          )
        )
      )
      .returning({ id: document.id })
    if (rewritten.length < ACCESS_REWRITE_BATCH_SIZE) break
  }
  await db
    .update(knowledgeConnector)
    .set({ accessRewritePending: false, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeConnector.id, run.connectorId),
        stillHoldsMemberSyncLock(run.connectorId, run.runId)
      )
    )
}

interface MembershipReconciliation {
  /** Documents whose ACL must be rematerialised because an observer's state or token changed. */
  affectedDocumentIds: Set<string>
}

/** The credential-group option the connector was bound to no longer exists. */
class MemberBindingGoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemberBindingGoneError'
  }
}

/**
 * Mirrors the credential-group option onto member rows: inserts new
 * credentials, moves members between active and suspended, rewrites a subject
 * token that changed, drops members whose credential left the option, and
 * purges members suspended past the window. Every change that alters what an
 * observer contributes to an ACL is collected for rematerialisation.
 */
async function reconcileMembership(
  run: MemberSyncRun,
  binding: { credentialGroupId: string; credentialGroupOptionId: string }
): Promise<MembershipReconciliation> {
  const group = await loadCredentialGroupCredentialListContext(binding.credentialGroupId)
  if (!group) {
    throw new MemberBindingGoneError(
      'The Credential Group this connector synced through was deleted'
    )
  }
  const option = group.options.find((candidate) => candidate.id === binding.credentialGroupOptionId)
  if (!option) {
    throw new MemberBindingGoneError(
      'The Credential Group option this connector synced through was removed'
    )
  }
  const optionState = {
    groupActive: group.status === 'active',
    optionActive: option.status === 'active',
  }

  const snapshots = new Map<string, MemberCredentialSnapshot>()
  let cursor: string | undefined
  do {
    const page = await listKnowledgeConnectorMemberCredentials({
      workspaceId: run.workspaceId,
      credentialGroupId: binding.credentialGroupId,
      credentialGroupOptionId: binding.credentialGroupOptionId,
      connectorId: run.connectorId,
      limit: MEMBER_CREDENTIAL_PAGE_SIZE,
      cursor,
    })
    for (const credential of page.credentials) {
      snapshots.set(credential.credentialId, {
        credentialId: credential.credentialId,
        subjectToken: subjectToken(credential),
        active: deriveMemberActive(credential, optionState),
      })
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)

  const existing = await db
    .select()
    .from(knowledgeConnectorMember)
    .where(eq(knowledgeConnectorMember.connectorId, run.connectorId))
  const existingByCredential = new Map(existing.map((row) => [row.credentialId, row]))
  const now = new Date()
  const purgeCutoff = new Date(now.getTime() - MEMBER_SUSPENDED_PURGE_DAYS * 24 * 60 * 60 * 1000)

  const inserts: (typeof knowledgeConnectorMember.$inferInsert)[] = []
  const affectedMemberIds: string[] = []
  const deleteMemberIds: string[] = []

  for (const snapshot of snapshots.values()) {
    const row = existingByCredential.get(snapshot.credentialId)
    const status = snapshot.active ? 'active' : 'suspended'
    if (!row) {
      inserts.push({
        id: generateId(),
        workspaceId: run.workspaceId,
        connectorId: run.connectorId,
        credentialId: snapshot.credentialId,
        subjectToken: snapshot.subjectToken,
        status,
        suspendedAt: snapshot.active ? null : now,
        /** Due now, so a run that cannot reach everyone re-dispatches until it has. */
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      })
      continue
    }
    if (
      row.status === 'suspended' &&
      !snapshot.active &&
      row.suspendedAt &&
      row.suspendedAt < purgeCutoff
    ) {
      deleteMemberIds.push(row.id)
      continue
    }
    const tokenChanged = row.subjectToken !== snapshot.subjectToken
    const statusChanged = row.status !== status
    if (!tokenChanged && !statusChanged) continue
    await db
      .update(knowledgeConnectorMember)
      .set({
        subjectToken: snapshot.subjectToken,
        status,
        suspendedAt: snapshot.active ? null : (row.suspendedAt ?? now),
        /** A reactivated member is due immediately; their observations may be stale. */
        ...(statusChanged && snapshot.active ? { nextAttemptAt: now, consecutiveFailures: 0 } : {}),
        updatedAt: now,
      })
      .where(eq(knowledgeConnectorMember.id, row.id))
    affectedMemberIds.push(row.id)
  }

  for (const row of existing) {
    if (!snapshots.has(row.credentialId)) deleteMemberIds.push(row.id)
  }

  const affectedDocumentIds = new Set<string>()
  if (deleteMemberIds.length > 0 || affectedMemberIds.length > 0) {
    for (const documentId of await listObservedDocumentIds(db, [
      ...deleteMemberIds,
      ...affectedMemberIds,
    ])) {
      affectedDocumentIds.add(documentId)
    }
  }
  if (deleteMemberIds.length > 0) {
    await db
      .delete(knowledgeConnectorMember)
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, run.connectorId),
          inArray(knowledgeConnectorMember.id, deleteMemberIds)
        )
      )
  }
  if (inserts.length > 0) {
    await db.insert(knowledgeConnectorMember).values(inserts).onConflictDoNothing()
  }

  logger.info('Reconciled members-mode membership', {
    connectorId: run.connectorId,
    credentials: snapshots.size,
    inserted: inserts.length,
    changed: affectedMemberIds.length,
    removed: deleteMemberIds.length,
    groupActive: optionState.groupActive,
    optionActive: optionState.optionActive,
  })
  return { affectedDocumentIds }
}

/**
 * Claims the next due member for this run. Sequential by design: one member
 * at a time keeps first-writer-wins deterministic and lets a single huge
 * member be aborted at the deadline without touching the others.
 */
async function claimNextMember(run: MemberSyncRun): Promise<MemberRow | null> {
  const [claimed] = await db
    .update(knowledgeConnectorMember)
    .set({ lastStartedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeConnectorMember.connectorId, run.connectorId),
        eq(
          knowledgeConnectorMember.id,
          sql`(
            SELECT ${knowledgeConnectorMember.id} FROM ${knowledgeConnectorMember}
            WHERE ${knowledgeConnectorMember.connectorId} = ${run.connectorId}
              AND ${knowledgeConnectorMember.status} = 'active'
              AND (${knowledgeConnectorMember.nextAttemptAt} IS NULL OR ${knowledgeConnectorMember.nextAttemptAt} <= now())
              AND (${knowledgeConnectorMember.lastStartedAt} IS NULL OR ${knowledgeConnectorMember.lastStartedAt} < ${sql.param(run.runStartedAt, knowledgeConnectorMember.lastStartedAt)})
            ORDER BY ${knowledgeConnectorMember.nextAttemptAt} ASC NULLS FIRST, ${knowledgeConnectorMember.lastStartedAt} ASC NULLS FIRST
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )`
        )
      )
    )
    .returning()
  return claimed ?? null
}

/**
 * Members still due once this run ends, which is what re-dispatch waits for.
 * Deliberately ignores `lastStartedAt`: a member this run claimed but could not
 * finish is re-armed for now, and the immediate re-dispatch this count
 * triggers is what lets them finish. A NULL `nextAttemptAt` means "with the
 * connector's next run" — a member that completed on a manual-only connector
 * — and must not keep the connector re-dispatching itself.
 */
async function countDueMembers(run: MemberSyncRun): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeConnectorMember)
    .where(
      and(
        eq(knowledgeConnectorMember.connectorId, run.connectorId),
        eq(knowledgeConnectorMember.status, 'active'),
        lte(knowledgeConnectorMember.nextAttemptAt, new Date())
      )
    )
  return row?.count ?? 0
}

async function recordMemberFailure(
  member: MemberRow,
  error: unknown,
  syncIntervalMinutes: number
): Promise<void> {
  const failures = member.consecutiveFailures + 1
  await db
    .update(knowledgeConnectorMember)
    .set({
      consecutiveFailures: failures,
      nextAttemptAt: new Date(Date.now() + memberFailureBackoffMs(failures, syncIntervalMinutes)),
      lastError: getErrorMessage(error),
      updatedAt: new Date(),
    })
    .where(eq(knowledgeConnectorMember.id, member.id))
}

/**
 * Whether a listing failure means the member simply cannot reach the
 * configured scope, which is a complete listing of nothing rather than an
 * error: the folder or space is not shared with them.
 */
function isScopeUnavailableError(connectorConfig: ConnectorConfig, error: unknown): boolean {
  return connectorConfig.isListingScopeUnavailableError?.(error) === true
}

interface MemberListing {
  kind: 'listed'
  mode: MemberListingMode
  documents: ExternalDocument[]
  removedExternalIds: string[]
  complete: boolean
  /** See {@link MemberListingOutcome.resumable}. */
  resumable: boolean
  /** The source itself said this member reaches nothing; not a listing shape to doubt. */
  authoritative: boolean
  startedAt: Date
  /** Cursor to store once the listing lands: a value, null to close the feed, undefined to leave it. */
  changeCursor: string | null | undefined
}

async function listForMember(input: {
  run: MemberSyncRun
  member: MemberRow
  connectorConfig: ConnectorConfig
  sourceConfig: Record<string, unknown>
  tokens: MemberTokenCache
  syncContext: Record<string, unknown>
  syncIntervalMinutes: number
  /** Relist fully even inside the recrawl window: the member's change feed could not be read. */
  forceFull?: boolean
}): Promise<MemberListing | { kind: 'failed' }> {
  const { run, member, connectorConfig, sourceConfig, syncContext } = input
  const startedAt = new Date()
  const feed = supportsChangeFeed(connectorConfig)
  const feedOpen = feed && Boolean(member.changeCursor)
  const full =
    input.forceFull === true ||
    shouldListFully(
      member.memberSyncedThrough,
      member.lastCompleteListingAt,
      startedAt,
      feedOpen ? MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES : MEMBER_FULL_RECRAWL_MINUTES
    )

  try {
    if (!full && feed && member.changeCursor) {
      let pass: Awaited<ReturnType<typeof runChangeFeedPass>>
      try {
        pass = await runChangeFeedPass({
          connectorId: run.connectorId,
          connectorConfig,
          sourceConfig,
          syncContext,
          cursor: member.changeCursor,
          beforePage: run.lease.beatIfDue,
          getAccessToken: () => input.tokens.get(member.id),
          deadlineAt: run.deadlineAt,
          maxPages: MEMBER_SYNC_MAX_PAGES_PER_MEMBER,
        })
      } catch (error) {
        if (connectorConfig.isChangeCursorInvalidError?.(error) !== true) throw error
        logger.warn('Member change feed cursor rejected; reopening it from a full listing', {
          connectorId: run.connectorId,
          memberId: member.id,
          error: getErrorMessage(error),
        })
        return listForMember({ ...input, forceFull: true })
      }
      const complete = pass.exhausted && !pass.budgetAborted
      return {
        kind: 'listed',
        mode: 'changes',
        documents: pass.upserts,
        removedExternalIds: pass.removedExternalIds,
        complete,
        /** The cursor already sits past every page read, so the next run continues. */
        resumable: !complete,
        authoritative: false,
        startedAt,
        changeCursor: pass.cursor,
      }
    }

    /**
     * The feed opens before the listing starts so a change that lands while
     * the listing is running is reported by the first feed read instead of
     * waiting for the next full listing.
     */
    const openedCursor =
      full && feed
        ? await connectorConfig.getChangeCursor(
            await input.tokens.get(member.id),
            sourceConfig,
            syncContext
          )
        : undefined
    const lastSyncAt =
      full || !member.memberSyncedThrough
        ? undefined
        : new Date(member.memberSyncedThrough.getTime() - INCREMENTAL_OVERLAP_MS)
    const listing = await runListingPass({
      connectorId: run.connectorId,
      connectorConfig,
      sourceConfig,
      syncContext,
      lastSyncAt,
      beforePage: run.lease.beatIfDue,
      getAccessToken: () => input.tokens.get(member.id),
      deadlineAt: run.deadlineAt,
      maxPages: MEMBER_SYNC_MAX_PAGES_PER_MEMBER,
    })
    const complete =
      listing.exhausted &&
      !listing.budgetAborted &&
      !syncContext.listingCapped &&
      !syncContext.reconciliationUnsafe
    return {
      kind: 'listed',
      mode: full ? 'full' : 'incremental',
      documents: listing.documents,
      removedExternalIds: [],
      complete,
      /** Only the deadline is worth retrying at once; a capped or truncated source reads the same next time. */
      resumable: listing.budgetAborted,
      authoritative: false,
      startedAt,
      changeCursor: full && complete ? openedCursor : undefined,
    }
  } catch (error) {
    if (error instanceof SyncLockLostException || error instanceof ConnectorSyncCapacityError) {
      throw error
    }
    if (isRateLimitError(error)) throw error
    if (isScopeUnavailableError(connectorConfig, error)) {
      logger.info('Member cannot reach the configured source scope; treating as an empty listing', {
        connectorId: run.connectorId,
        memberId: member.id,
      })
      return {
        kind: 'listed',
        mode: 'full',
        documents: [],
        removedExternalIds: [],
        complete: true,
        resumable: false,
        authoritative: true,
        startedAt,
        /** A feed over a scope the member cannot reach says nothing; the next full listing reopens one. */
        changeCursor: null,
      }
    }
    logger.warn('Member listing failed', {
      connectorId: run.connectorId,
      memberId: member.id,
      error: getErrorMessage(error),
    })
    await recordMemberFailure(member, error, input.syncIntervalMinutes)
    run.result.membersFailed += 1
    return { kind: 'failed' }
  }
}

/**
 * Writes what one member's listing established: observations for everything
 * they saw, removals only after a full, complete, non-suspect listing or by
 * the change feed's explicit word, and the member's schedule, watermark, and
 * feed cursor. Returns the documents whose ACL changed.
 */
async function applyMemberListing(
  run: MemberSyncRun,
  outcome: MemberListingOutcome,
  documentIdByExternalId: Map<string, string>,
  syncIntervalMinutes: number
): Promise<Set<string>> {
  const affected = new Set<string>()
  const seenDocumentIds: string[] = []
  for (const externalId of outcome.seenExternalIds) {
    const documentId = documentIdByExternalId.get(externalId)
    if (documentId) seenDocumentIds.push(documentId)
  }
  const removesAllowed = outcome.mode === 'full' && outcome.complete && !outcome.suspect
  const now = new Date()

  await db.transaction(async (tx) => {
    const added = await recordMemberObservations(tx, outcome.member.id, seenDocumentIds, run.runId)
    run.result.observationsAdded += added
    /**
     * Every seen document is rematerialised, not only the newly observed ones:
     * a run that died between writing observations and writing ACLs left them
     * hidden, and the observation graph is the only record that says so.
     * Rematerialising an already-correct ACL is a no-op write.
     */
    for (const documentId of seenDocumentIds) affected.add(documentId)
    if (removesAllowed) {
      const removed = await removeUnseenMemberObservations(tx, outcome.member.id, run.runId)
      run.result.observationsRemoved += removed.length
      for (const documentId of removed) affected.add(documentId)
    } else if (outcome.mode === 'changes') {
      const removedDocumentIds: string[] = []
      for (const externalId of outcome.removedExternalIds) {
        const documentId = documentIdByExternalId.get(externalId)
        if (documentId) removedDocumentIds.push(documentId)
      }
      const removed = await removeMemberObservationsForDocuments(
        tx,
        outcome.member.id,
        removedDocumentIds
      )
      run.result.observationsRemoved += removed.length
      for (const documentId of removed) affected.add(documentId)
    }
    await tx
      .update(knowledgeConnectorMember)
      .set({
        consecutiveFailures: 0,
        lastError: null,
        ...(outcome.mode === 'full' ? { lastListedCount: outcome.listedCount } : {}),
        nextAttemptAt: outcome.resumable
          ? now
          : nextMemberSyncTime(now, syncIntervalMinutes, false),
        ...(removesAllowed
          ? { lastCompleteListingAt: now, memberSyncedThrough: outcome.listingStartedAt }
          : {}),
        ...(outcome.mode === 'changes' && outcome.complete
          ? { memberSyncedThrough: outcome.listingStartedAt }
          : {}),
        ...(outcome.changeCursor !== undefined
          ? {
              changeCursor: outcome.changeCursor,
              changeCursorAt: outcome.changeCursor === null ? null : now,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(knowledgeConnectorMember.id, outcome.member.id))
  })

  if (outcome.complete) run.result.membersCompleted += 1
  else run.result.membersIncomplete += 1
  return affected
}

async function loadDocumentIdsByExternalId(connectorId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: document.id, externalId: document.externalId })
    .from(document)
    .where(and(eq(document.connectorId, connectorId), isNull(document.archivedAt)))
    .limit(syncWorkingSetQueryLimit(0))
  const byExternalId = new Map<string, string>()
  for (const row of rows) {
    if (row.externalId && !byExternalId.has(row.externalId))
      byExternalId.set(row.externalId, row.id)
  }
  return byExternalId
}

async function completeMemberSync(
  run: MemberSyncRun,
  syncIntervalMinutes: number
): Promise<boolean> {
  const { result } = run
  const now = new Date()
  const nextMemberSyncAt = nextMemberSyncTime(now, syncIntervalMinutes, result.membersRemaining)
  return db.transaction(async (tx) => {
    const [activeKnowledgeBase] = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, run.knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .for('update')
    if (!activeKnowledgeBase) {
      /** Nothing to record against a deleted knowledge base; hand the lease back rather than let it expire as a failure. */
      await tx
        .update(knowledgeConnectorMemberSyncLog)
        .set({
          status: 'failed',
          completedAt: now,
          errorMessage: 'Knowledge base deleted during sync',
        })
        .where(
          and(
            eq(knowledgeConnectorMemberSyncLog.id, run.runId),
            eq(knowledgeConnectorMemberSyncLog.status, 'started')
          )
        )
      await tx
        .update(knowledgeConnector)
        .set({
          memberSyncStatus: 'idle',
          nextMemberSyncAt: null,
          memberSyncLockToken: null,
          memberSyncLockLeaseAt: null,
          updatedAt: now,
        })
        .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
      return false
    }
    const [held] = await tx
      .select({ id: knowledgeConnector.id })
      .from(knowledgeConnector)
      .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
      .for('update')
    if (!held) return false

    const [closedLog] = await tx
      .update(knowledgeConnectorMemberSyncLog)
      .set({
        status: 'completed',
        completedAt: now,
        membersClaimed: result.membersClaimed,
        membersCompleted: result.membersCompleted,
        membersIncomplete: result.membersIncomplete,
        membersFailed: result.membersFailed,
        docsListed: result.docsListed,
        docsAdded: result.docsAdded,
        docsUpdated: result.docsUpdated,
        docsUnchanged: result.docsUnchanged,
        docsHydratedOnce: result.docsHydratedOnce,
        observationsAdded: result.observationsAdded,
        observationsRemoved: result.observationsRemoved,
        docsTombstoned: result.docsTombstoned,
        docsResurrected: result.docsResurrected,
        docsPurged: result.docsPurged,
        credentialsAudited: result.credentialsAudited,
      })
      .where(
        and(
          eq(knowledgeConnectorMemberSyncLog.id, run.runId),
          eq(knowledgeConnectorMemberSyncLog.status, 'started')
        )
      )
      .returning({ id: knowledgeConnectorMemberSyncLog.id })
    if (!closedLog) return false

    const [written] = await tx
      .update(knowledgeConnector)
      .set({
        memberSyncStatus: 'idle',
        lastMemberSyncAt: now,
        nextMemberSyncAt,
        lastMemberSyncError: null,
        memberSyncConsecutiveFailures: 0,
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
        updatedAt: now,
      })
      .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
      .returning({ id: knowledgeConnector.id })
    return Boolean(written)
  })
}

async function failMemberSyncLog(runId: string, result: MemberSyncResult, errorMessage: string) {
  await db
    .update(knowledgeConnectorMemberSyncLog)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage,
      membersClaimed: result.membersClaimed,
      membersCompleted: result.membersCompleted,
      membersIncomplete: result.membersIncomplete,
      membersFailed: result.membersFailed,
      docsListed: result.docsListed,
      docsAdded: result.docsAdded,
      docsUpdated: result.docsUpdated,
      docsUnchanged: result.docsUnchanged,
      docsHydratedOnce: result.docsHydratedOnce,
      observationsAdded: result.observationsAdded,
      observationsRemoved: result.observationsRemoved,
      docsTombstoned: result.docsTombstoned,
      docsResurrected: result.docsResurrected,
      docsPurged: result.docsPurged,
      credentialsAudited: result.credentialsAudited,
    })
    .where(
      and(
        eq(knowledgeConnectorMemberSyncLog.id, runId),
        eq(knowledgeConnectorMemberSyncLog.status, 'started')
      )
    )
}

/**
 * Disables member sync on a connector that can no longer run it — the
 * workspace lost Credential Groups, or the group binding is gone — and
 * suspends every member so their tokens leave every ACL. Nothing is purged:
 * re-enabling restores access from the retained observations.
 */
async function disableMemberSync(run: MemberSyncRun, reason: string): Promise<void> {
  const now = new Date()
  const suspended = await db
    .update(knowledgeConnectorMember)
    .set({ status: 'suspended', suspendedAt: now, updatedAt: now })
    .where(
      and(
        eq(knowledgeConnectorMember.connectorId, run.connectorId),
        eq(knowledgeConnectorMember.status, 'active')
      )
    )
    .returning({ id: knowledgeConnectorMember.id })
  if (suspended.length > 0) {
    const affected = await listObservedDocumentIds(
      db,
      suspended.map((row) => row.id)
    )
    await materializeDocumentAcls(run.connectorId, affected)
  }
  await failMemberSyncLog(run.runId, run.result, reason)
  await db
    .update(knowledgeConnector)
    .set({
      memberSyncStatus: 'disabled',
      lastMemberSyncError: reason,
      nextMemberSyncAt: null,
      memberSyncLockToken: null,
      memberSyncLockLeaseAt: null,
      updatedAt: now,
    })
    .where(holdsMemberSyncLockToken(run.connectorId, run.runId))
  logger.warn('Member sync disabled', { connectorId: run.connectorId, reason })
}

/**
 * Executes one members-mode run for a connector: reconciles membership from
 * the credential-group option, crawls the source once per due member with that
 * member's own token until the budget ends, hydrates every listed document
 * once, records who observed what, materialises the ACLs, applies the document
 * lifecycle, and re-dispatches itself while members remain due.
 */
export async function executeMemberSync(
  connectorId: string,
  options: ExecuteMemberSyncOptions
): Promise<MemberSyncResult> {
  const billingAttribution = assertBillingAttributionSnapshot(options.billingAttribution)
  const result = emptyResult()

  const [connectorBeforeLock] = await db
    .select()
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .limit(1)
  if (!connectorBeforeLock) {
    logger.warn('Skipping member sync: connector not found, archived, or deleted', { connectorId })
    return skipped(result, 'connector_unavailable')
  }
  if (connectorBeforeLock.accessMode !== 'members') {
    logger.info('Skipping member sync: connector does not sync per member', { connectorId })
    return skipped(result, 'connector_not_syncable')
  }
  const connectorConfig = CONNECTOR_REGISTRY[connectorBeforeLock.connectorType]
  if (!connectorConfig) {
    throw new Error(`Unknown connector type: ${connectorBeforeLock.connectorType}`)
  }

  const [kbRow] = await db
    .select({ userId: knowledgeBase.userId, workspaceId: knowledgeBase.workspaceId })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.id, connectorBeforeLock.knowledgeBaseId),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)
  if (!kbRow) {
    logger.warn('Skipping member sync: knowledge base is deleted', { connectorId })
    await db
      .update(knowledgeConnector)
      .set({
        memberSyncStatus: 'error',
        nextMemberSyncAt: null,
        lastMemberSyncError: 'Knowledge base deleted',
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, connectorId))
    return skipped(result, 'knowledge_base_deleted')
  }
  if (!kbRow.workspaceId) {
    throw new Error(
      `Knowledge base ${connectorBeforeLock.knowledgeBaseId} is missing workspace billing context`
    )
  }
  if (billingAttribution.workspaceId !== kbRow.workspaceId) {
    throw new Error(
      `Member sync billing attribution does not match knowledge base workspace ${kbRow.workspaceId}`
    )
  }
  const kbOwner: KnowledgeBaseOwner = { workspaceId: kbRow.workspaceId, userId: kbRow.userId }

  const runId = generateId()
  const connector = await acquireMemberSyncLock(connectorId, runId, options.dispatchToken)
  if (!connector) {
    const [current] = await db
      .select({
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        memberSyncLockToken: knowledgeConnector.memberSyncLockToken,
        syncLockToken: knowledgeConnector.syncLockToken,
      })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
      .limit(1)
    if (current?.memberSyncStatus === 'disabled' || current?.syncLockToken) {
      logger.info('Connector is not accepting member syncs, skipping', { connectorId })
      return skipped(result, 'connector_not_syncable')
    }
    if (options.dispatchToken && current?.memberSyncLockToken !== options.dispatchToken) {
      logger.info('Member sync superseded by a newer dispatch, skipping', { connectorId })
      return skipped(result, 'dispatch_superseded')
    }
    logger.info('Member sync already in progress, skipping', { connectorId })
    return skipped(result, 'sync_in_progress')
  }

  const runStartedAt = new Date()
  const run: MemberSyncRun = {
    connectorId,
    knowledgeBaseId: connector.knowledgeBaseId,
    workspaceId: kbRow.workspaceId,
    runId,
    runStartedAt,
    deadlineAt: runStartedAt.getTime() + MEMBER_SYNC_SOFT_BUDGET_SECONDS * 1000,
    result,
    lease: createMemberSyncLease(connectorId, runId),
  }
  await insertMemberSyncLog(runId, connectorId, runStartedAt)

  try {
    const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(run.workspaceId)
    if (!(await isCredentialGroupsAvailable({ workspaceId: run.workspaceId, ownerBilling }))) {
      await disableMemberSync(run, 'Credential Groups are not available for this workspace')
      return {
        ...skipped(result, 'connector_not_syncable'),
        error: 'Credential Groups are not available',
      }
    }
    if (!(await isKnowledgeMemberAccessAvailable({ workspaceId: run.workspaceId }))) {
      await disableMemberSync(run, 'Per-member access is not enabled for this workspace')
      return {
        ...skipped(result, 'connector_not_syncable'),
        error: 'Per-member access is not enabled',
      }
    }
    if (!connector.credentialGroupId || !connector.credentialGroupOptionId) {
      await disableMemberSync(run, 'Connector is no longer attached to a Credential Group option')
      return {
        ...skipped(result, 'connector_not_syncable'),
        error: 'Connector is no longer attached to a Credential Group option',
      }
    }
    if (!connectorConfig.permissionScopedListing || connectorConfig.auth.mode !== 'oauth') {
      throw new Error(`Connector ${connectorConfig.id} cannot sync per member`)
    }
    const binding = {
      credentialGroupId: connector.credentialGroupId,
      credentialGroupOptionId: connector.credentialGroupOptionId,
    }
    const sourceConfig = connector.sourceConfig as Record<string, unknown>

    if (connector.accessRewritePending) await finishPendingAccessRewrite(run)

    const affectedDocumentIds = new Set<string>()
    /**
     * Anyone who joined the workspace since the last run is invited now, so
     * membership grows on its own; the invitation is the only thing they need.
     */
    const invited = await inviteWorkspaceMembersToCredentialGroup({
      workspaceId: run.workspaceId,
      credentialGroupId: connector.credentialGroupId,
      inviterUserId: undefined,
      limit: MEMBER_PROVISION_INVITES_PER_RUN,
    }).catch((error) => {
      logger.warn('Failed to invite new workspace members during a member run', {
        connectorId,
        error: getErrorMessage(error),
      })
      return null
    })
    if (invited && invited.invited > 0) {
      logger.info('Invited new workspace members to the connector credential group', {
        connectorId,
        ...invited,
      })
    }
    const membership = await reconcileMembership(run, binding)
    for (const documentId of membership.affectedDocumentIds) affectedDocumentIds.add(documentId)

    const members = await db
      .select({
        id: knowledgeConnectorMember.id,
        credentialId: knowledgeConnectorMember.credentialId,
      })
      .from(knowledgeConnectorMember)
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, connectorId),
          eq(knowledgeConnectorMember.status, 'active')
        )
      )
    const credentialIdByMemberId = new Map(
      members.map((member) => [member.id, member.credentialId])
    )
    const tokens = createMemberTokenCache({ run, connectorConfig, credentialIdByMemberId })
    const syncContexts = new Map<string, Record<string, unknown>>()

    const union = new Map<string, UnionEntry>()
    const outcomes: MemberListingOutcome[] = []
    let retainedBytes = 0

    while (Date.now() < run.deadlineAt) {
      const member = await claimNextMember(run)
      if (!member) break
      result.membersClaimed += 1
      const syncContext: Record<string, unknown> = { syncRunId: runId, memberId: member.id }
      syncContexts.set(member.id, syncContext)

      const listed = await listForMember({
        run,
        member,
        connectorConfig,
        sourceConfig,
        tokens,
        syncContext,
        syncIntervalMinutes: connector.syncIntervalMinutes,
      })
      if (listed.kind === 'failed') continue

      const admitted = admitMemberListing(
        union,
        member.id,
        listed.documents,
        connectorId,
        retainedBytes
      )
      retainedBytes = admitted.retainedBytes
      result.docsListed += admitted.seenExternalIds.size
      /**
       * A listing that collapsed against the member's previous one is doubted
       * once: removals wait for the next full listing to say the same, which it
       * does by then comparing against the collapsed count. A source that said
       * outright the member reaches nothing is not a shape to doubt.
       */
      const suspect =
        listed.mode === 'full' &&
        !listed.authoritative &&
        classifySuspectListing(admitted.seenExternalIds.size, member.lastListedCount ?? 0) !== null
      if (suspect) {
        logger.warn('Suspect member listing; removals withheld', {
          connectorId,
          memberId: member.id,
          listed: admitted.seenExternalIds.size,
          previouslyListed: member.lastListedCount,
        })
      }
      outcomes.push({
        member,
        mode: listed.mode,
        listingStartedAt: listed.startedAt,
        seenExternalIds: admitted.seenExternalIds,
        removedExternalIds: listed.removedExternalIds,
        listedCount: admitted.seenExternalIds.size,
        complete: listed.complete,
        resumable: listed.resumable,
        suspect,
        /** A doubted listing does not open the feed either: the next full listing decides. */
        changeCursor: suspect ? undefined : listed.changeCursor,
      })
    }

    const corpus = await loadOwnedCorpus(connectorId)
    const state = createSyncRunState(result)
    const externalDocs = [...union.values()].map((entry) => entry.document)
    const pendingOps = classifyListing({ externalDocs, corpus, forceRehydrate: false, state })
    result.docsHydratedOnce = pendingOps.filter(
      (op) => op.type !== 'skip' && op.extDoc.contentDeferred
    ).length

    await processDocOps({
      connectorId,
      connector,
      sourceConfig,
      kbOwner,
      billingAttribution,
      pendingOps,
      corpus,
      forceRehydrate: false,
      state,
      hydration: {
        getDocument: async (externalId) => {
          const observers = union.get(externalId)?.observers ?? []
          let lastError: unknown
          for (const memberId of observers.slice(0, HYDRATION_OBSERVER_ATTEMPTS)) {
            try {
              const accessToken = await tokens.get(memberId)
              const hydrated = await connectorConfig.getDocument(
                accessToken,
                sourceConfig,
                externalId,
                syncContexts.get(memberId)
              )
              if (hydrated) return hydrated
            } catch (error) {
              if (isRateLimitError(error)) throw error
              if (error instanceof KnowledgeConnectorMemberAccessDeniedError) continue
              lastError = error
            }
          }
          if (lastError) throw lastError
          return null
        },
      },
      lease: run.lease,
      documentAccess: 'members',
    })

    const documentIdByExternalId = await loadDocumentIdsByExternalId(connectorId)
    for (const outcome of outcomes) {
      await run.lease.beatIfDue()
      const affected = await applyMemberListing(
        run,
        outcome,
        documentIdByExternalId,
        connector.syncIntervalMinutes
      )
      for (const documentId of affected) affectedDocumentIds.add(documentId)
    }

    await materializeDocumentAcls(connectorId, affectedDocumentIds)

    const lifecycle = await applyMemberDocumentLifecycle({
      connectorId,
      knowledgeBaseId: connector.knowledgeBaseId,
      runId,
      lease: run.lease,
      failedExternalIds: state.failedExternalIds,
    })
    result.docsTombstoned = lifecycle.tombstoned
    result.docsResurrected = lifecycle.resurrected
    result.docsPurged = lifecycle.purged
    result.docsDeleted = lifecycle.purged

    await sweepStuckDocuments({
      connectorId,
      knowledgeBaseId: connector.knowledgeBaseId,
      syncStartedAt: runStartedAt,
      retryCutoff: new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      billingAttribution,
      result,
      lease: run.lease,
    })

    result.membersRemaining = (await countDueMembers(run)) > 0
    const landed = await completeMemberSync(run, connector.syncIntervalMinutes)
    if (!landed) {
      logger.warn(
        'Member sync result discarded — connector was reclaimed while this run was executing',
        {
          connectorId,
          runId,
        }
      )
      return skipped(result, 'sync_superseded')
    }
    logger.info('Member sync completed', { connectorId, runId, ...result })
    return result
  } catch (error) {
    if (error instanceof SyncLockLostException) {
      logger.warn('Member sync abandoned — lock was reclaimed while this run was executing', {
        connectorId,
        runId,
      })
      return skipped(result, 'sync_superseded')
    }
    if (error instanceof ConnectorDeletedException) {
      logger.info('Connector deleted during member sync', { connectorId })
      await failMemberSyncLog(runId, result, 'Connector deleted during sync').catch(() => undefined)
      return skipped(result, 'connector_deleted_during_sync')
    }
    if (error instanceof MemberBindingGoneError) {
      await disableMemberSync(run, error.message)
      return { ...skipped(result, 'connector_not_syncable'), error: error.message }
    }

    const errorMessage = toError(error).message
    const retryAfterMs = getRetryAfterMs(error)
    logger.error('Member sync failed', { connectorId, runId, error: errorMessage })
    try {
      await failMemberSyncLog(runId, result, errorMessage)
      const failureUpdate =
        error instanceof ConnectorSyncCapacityError
          ? {
              memberSyncStatus: 'error' as const,
              lastMemberSyncError: errorMessage,
              nextMemberSyncAt: null,
              memberSyncConsecutiveFailures: connector.memberSyncConsecutiveFailures,
              memberSyncLockToken: null,
              memberSyncLockLeaseAt: null,
              updatedAt: new Date(),
            }
          : buildMemberSyncFailureUpdate(
              new Date(),
              connector.memberSyncConsecutiveFailures,
              errorMessage,
              retryAfterMs
            )
      const written = await db
        .update(knowledgeConnector)
        .set(failureUpdate)
        .where(stillHoldsMemberSyncLock(connectorId, runId))
        .returning({ id: knowledgeConnector.id })
      if (written.length === 0) {
        logger.warn('Member sync failure discarded — connector was reclaimed', {
          connectorId,
          runId,
        })
      }
    } catch (recoveryError) {
      logger.error('Failed to record member sync failure', {
        connectorId,
        error: toError(recoveryError).message,
      })
    }
    result.error = errorMessage
    return result
  }
}
