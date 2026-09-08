import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
  knowledgeDocumentObservation,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { and, asc, eq, gt, inArray, isNull, lte, notExists, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import {
  assertBillingAttributionOwner,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import {
  CredentialGroupCredentialCursorNotFoundError,
  type CredentialGroupOptionCredentialReference,
  isManagedCredentialGroupBindingLive,
  loadScopedAccountsCredentialListContext,
} from '@/lib/credential-groups/credentials'
import type { DbOrTx } from '@/lib/db/types'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { EMPTY_ACL, subjectToken } from '@/lib/knowledge/access/tokens'
import { effectiveConnectorSyncIntervalMinutes } from '@/lib/knowledge/connectors/access-modes'
import {
  resolveConnectorAccessToken,
  resolveConnectorTokenUserId,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
  listingFingerprint,
  readListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import {
  listKnowledgeConnectorMemberCredentials,
  mintKnowledgeConnectorMemberToken,
  rejectKnowledgeConnectorMemberToken,
} from '@/lib/knowledge/connectors/member-access'
import {
  applyMemberDocumentLifecycle,
  materializeDocumentAcls,
  recordMemberObservations,
  removeMemberObservationsForDocuments,
  removeUnseenMemberObservations,
  rewriteConnectorAcls,
} from '@/lib/knowledge/connectors/member-observations'
import { inviteWorkspaceMembersToCredentialGroup } from '@/lib/knowledge/connectors/member-provisioning'
import { runConnectorContentPass } from '@/lib/knowledge/connectors/sync-content-pass'
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
  SOURCE_CONTENT_ERROR,
} from '@/lib/knowledge/connectors/sync-limits'
import {
  assertSyncLeaseHeldInTx,
  createMemberSyncLease,
  holdsMemberSyncLockToken,
  MEMBER_LOCKABLE_CONNECTOR_STATUSES,
  SyncLockLostException,
  stillHoldsMemberSyncLock,
} from '@/lib/knowledge/connectors/sync-lock'
import {
  type KnowledgeBaseOwner,
  persistSourceDocumentFailures,
} from '@/lib/knowledge/connectors/sync-persistence'
import {
  ConnectorDeletedException,
  ConnectorSyncCapacityError,
  classifyListing,
  classifySuspectListing,
  createSyncRunState,
  loadPageCorpus,
  processDocOps,
  RETRY_WINDOW_DAYS,
  runChangeFeedPass,
  sweepStuckDocuments,
} from '@/lib/knowledge/connectors/sync-primitives'
import { getRetryAfterMs, isRateLimitError } from '@/lib/knowledge/documents/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type {
  ConnectorConfig,
  ExternalDocument,
  SyncResult,
  SyncSkipReason,
} from '@/connectors/types'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const logger = createLogger('ConnectorMemberSyncEngine')

/** Observers tried, in listing order, before a document's hydration is given up on. */
const HYDRATION_OBSERVER_ATTEMPTS = 3
/** A minted token is reused for this long before the member is re-minted. */
const MEMBER_TOKEN_REUSE_MS = 45 * 60 * 1000
/** Members whose tokens one run keeps at once; a memory backstop, not a working-set limit. */
const MEMBER_TOKEN_CACHE_MAX = 10_000
/** Overlap subtracted from a member's incremental watermark, covering source clock skew. */
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000
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
  /** Explicit sync requests refresh content even when its configured interval has not elapsed. */
  forceContentRefresh?: boolean
  /** The queue entry this run is allowed to consume; see `MemberSyncPayload.dispatchToken`. */
  dispatchToken?: string
}

type MemberRow = typeof knowledgeConnectorMember.$inferSelect

/** One member's credential as the option reports it, with the membership state it implies. */
interface MemberCredentialSnapshot {
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
  contentFailures: boolean
  /** Cursor to store when this outcome lands: a value, null to close the feed, undefined to leave it. */
  changeCursor: string | null | undefined
  checkpoint?: ListingCheckpoint
  observationRunId?: string
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
  return isManagedCredentialGroupBindingLive({
    managedOauthStatus: credential.managedOauthStatus,
    enrollmentStatus: credential.enrollmentStatus,
    groupStatus: option.groupActive ? 'active' : 'disabled',
    optionStatus: option.optionActive ? 'active' : 'disabled',
  })
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

/** Whether a connector's change feed covers the configured source scope. */
function supportsChangeFeed(
  connectorConfig: ConnectorConfig,
  sourceConfig: Record<string, unknown>
): connectorConfig is ConnectorConfig & {
  listChanges: NonNullable<ConnectorConfig['listChanges']>
  getChangeCursor: NonNullable<ConnectorConfig['getChangeCursor']>
} {
  return (
    typeof connectorConfig.listChanges === 'function' &&
    typeof connectorConfig.getChangeCursor === 'function' &&
    connectorConfig.supportsChangeFeed?.(sourceConfig) !== false
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

/**
 * When a member who completed is next due: exactly one interval on, with no
 * jitter, so they are due whenever the connector's own (jittered) run lands.
 * Null on a manual-only connector: with its next manual run.
 */
export function memberNextAttemptAt(now: Date, syncIntervalMinutes: number): Date | null {
  const interval = effectiveConnectorSyncIntervalMinutes('members', syncIntervalMinutes)
  return interval > 0 ? new Date(now.getTime() + interval * 60_000) : null
}

/** The next scheduled run: immediately while members remain due, else the interval plus jitter. */
export function nextMemberSyncTime(
  now: Date,
  syncIntervalMinutes: number,
  membersRemaining: boolean
): Date | null {
  if (membersRemaining) return now
  const interval = effectiveConnectorSyncIntervalMinutes('members', syncIntervalMinutes)
  if (interval <= 0) return null
  const jitterMs = randomInt(0, Math.min(interval * 6_000, 300_000))
  return new Date(now.getTime() + interval * 60_000 + jitterMs)
}

interface MemberSyncRun {
  connectorId: string
  knowledgeBaseId: string
  workspaceId?: string
  organizationId?: string
  runId: string
  runStartedAt: Date
  deadlineAt: number
  result: MemberSyncResult
  lease: ReturnType<typeof createMemberSyncLease>
}

/** A token minted for a member, reused within the run until it ages out. */
interface MemberTokenCache {
  get(memberId: string): Promise<string>
  reject(memberId: string): Promise<boolean>
}

function createMemberTokenCache(input: {
  run: MemberSyncRun
  connectorConfig: Pick<ConnectorConfig, 'auth'>
  credentialIdByMemberId: Map<string, string>
}): MemberTokenCache {
  const { auth } = input.connectorConfig
  if (auth.mode !== 'oauth') throw new Error('Members mode requires an OAuth connector')
  const tokens = new LRUCache<string, string>({
    max: MEMBER_TOKEN_CACHE_MAX,
    ttl: MEMBER_TOKEN_REUSE_MS,
    fetchMethod: async (memberId) => {
      const credentialId = input.credentialIdByMemberId.get(memberId)
      if (!credentialId) throw new Error(`Member ${memberId} has no credential in this run`)
      const minted = await mintKnowledgeConnectorMemberToken({
        connectorId: input.run.connectorId,
        workspaceId: input.run.workspaceId,
        organizationId: input.run.organizationId,
        credentialId,
        expectedProviderId: auth.provider,
        requiredScopes: auth.requiredScopes ?? [],
        runId: input.run.runId,
      })
      input.run.result.credentialsAudited += 1
      return minted.accessToken
    },
  })
  return {
    async reject(memberId) {
      const rejectedAccessToken = tokens.get(memberId)
      const credentialId = input.credentialIdByMemberId.get(memberId)
      if (!rejectedAccessToken || !credentialId) return false
      tokens.delete(memberId)
      return rejectKnowledgeConnectorMemberToken({
        connectorId: input.run.connectorId,
        workspaceId: input.run.workspaceId,
        organizationId: input.run.organizationId,
        credentialId,
        expectedProviderId: auth.provider,
        requiredScopes: auth.requiredScopes ?? [],
        rejectedAccessToken,
        runId: input.run.runId,
      })
    },
    async get(memberId) {
      const accessToken = await tokens.fetch(memberId)
      if (!accessToken) throw new Error(`No token could be minted for member ${memberId}`)
      return accessToken
    },
  }
}

/**
 * Runs `fn` in a transaction that first proves this run still holds the
 * connector's member lease, taking the connector row's lock so the scheduler
 * cannot reclaim the lease mid-transaction. A run that stalled past the lease
 * TTL and resumed after a replacement took over therefore never lands its
 * observations or ACLs over the replacement's; it ends as superseded.
 */
async function withMemberLease<T>(
  run: Pick<MemberSyncRun, 'connectorId' | 'runId'>,
  fn: (tx: DbOrTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const [held] = await tx
      .select({ id: knowledgeConnector.id })
      .from(knowledgeConnector)
      .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
      .for('update')
    if (!held) throw new SyncLockLostException(run.connectorId)
    return fn(tx)
  })
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
        inArray(knowledgeConnector.status, MEMBER_LOCKABLE_CONNECTOR_STATUSES),
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
 * makes it visible again. Bounded by the run's own budget like every other
 * step, so a large corpus is hidden across as many runs as it takes rather
 * than one run that never reaches a member; returns whether it finished.
 */
async function finishPendingAccessRewrite(run: MemberSyncRun): Promise<boolean> {
  const finished = await rewriteConnectorAcls(run.connectorId, EMPTY_ACL, {
    deadlineAt: run.deadlineAt,
    beforeBatch: run.lease.beatIfDue,
    lease: run.lease,
  })
  if (!finished) return false
  await db
    .update(knowledgeConnector)
    .set({ accessRewritePending: false, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeConnector.id, run.connectorId),
        stillHoldsMemberSyncLock(run.connectorId, run.runId)
      )
    )
  return true
}

interface MembershipRewriteCheckpoint {
  kind: 'membership'
  cursor: string | null
  removeMember: boolean
}

function membershipRewrite(value: unknown): MembershipRewriteCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const checkpoint = value as Record<string, unknown>
  return checkpoint.kind === 'membership' &&
    (checkpoint.cursor === null || typeof checkpoint.cursor === 'string') &&
    typeof checkpoint.removeMember === 'boolean'
    ? { kind: 'membership', cursor: checkpoint.cursor, removeMember: checkpoint.removeMember }
    : null
}

/** Keeps observations available until every changed ACL is rewritten, resuming by document identity. */
export async function resumeMembershipRewrites(
  run: Pick<MemberSyncRun, 'connectorId' | 'runId' | 'deadlineAt' | 'lease'>
): Promise<boolean> {
  for (;;) {
    if (Date.now() >= run.deadlineAt) return false
    await run.lease.beatIfDue()
    const [member] = await db
      .select({
        id: knowledgeConnectorMember.id,
        checkpoint: knowledgeConnectorMember.listingCheckpoint,
      })
      .from(knowledgeConnectorMember)
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, run.connectorId),
          sql`${knowledgeConnectorMember.listingCheckpoint}->>'kind' = 'membership'`
        )
      )
      .orderBy(asc(knowledgeConnectorMember.id))
      .limit(1)
    if (!member) return true
    const checkpoint = membershipRewrite(member.checkpoint)
    if (!checkpoint) throw new Error('Invalid membership ACL checkpoint')
    await withMemberLease(run, async (tx) => {
      const documents = await tx
        .select({ documentId: knowledgeDocumentObservation.documentId })
        .from(knowledgeDocumentObservation)
        .where(
          and(
            eq(knowledgeDocumentObservation.memberId, member.id),
            checkpoint.cursor
              ? gt(knowledgeDocumentObservation.documentId, checkpoint.cursor)
              : undefined
          )
        )
        .orderBy(asc(knowledgeDocumentObservation.documentId))
        .limit(500)
      await materializeDocumentAcls(
        run.connectorId,
        documents.map((row) => row.documentId),
        tx
      )
      if (documents.length === 0 && checkpoint.removeMember) {
        await tx.delete(knowledgeConnectorMember).where(eq(knowledgeConnectorMember.id, member.id))
      } else {
        await tx
          .update(knowledgeConnectorMember)
          .set({
            listingCheckpoint:
              documents.length === 0
                ? null
                : { ...checkpoint, cursor: documents.at(-1)!.documentId },
          })
          .where(eq(knowledgeConnectorMember.id, member.id))
      }
    })
  }
}

/** The credential-group option the connector was bound to no longer exists. */
class MemberBindingGoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemberBindingGoneError'
  }
}

interface DirectoryCheckpoint {
  version: 1
  fingerprint: string
  phase: 'listing' | 'cleanup' | 'complete'
  cursor: string | null
}

function readDirectoryCheckpoint(value: unknown, fingerprint: string): DirectoryCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    item.version !== 1 ||
    item.fingerprint !== fingerprint ||
    (item.phase !== 'listing' && item.phase !== 'cleanup' && item.phase !== 'complete') ||
    !(item.cursor === null || (typeof item.cursor === 'string' && item.cursor.length <= 512))
  )
    return null
  return { version: 1, fingerprint, phase: item.phase, cursor: item.cursor }
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
  binding: { credentialGroupId: string; credentialGroupOptionId: string },
  savedCheckpoint: unknown,
  forceRefresh: boolean
): Promise<boolean> {
  const group = await loadScopedAccountsCredentialListContext(
    resourceScopeFromOwner(run),
    binding.credentialGroupId
  )
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

  const fingerprint = listingFingerprint({
    workspaceId: run.workspaceId,
    organizationId: run.organizationId,
    ...binding,
    option,
    status: group.status,
  })
  let checkpoint: DirectoryCheckpoint = readDirectoryCheckpoint(savedCheckpoint, fingerprint) ?? {
    version: 1,
    fingerprint,
    phase: 'listing',
    cursor: null,
  }
  if (forceRefresh && checkpoint.phase === 'complete')
    checkpoint = { ...checkpoint, phase: 'listing', cursor: null }
  if (checkpoint.phase === 'complete') return true
  const saveCheckpoint = (tx: DbOrTx, next: DirectoryCheckpoint | null) =>
    tx
      .update(knowledgeConnector)
      .set({ directoryCheckpoint: next ? { ...next } : null })
      .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
  await withMemberLease(run, (tx) => saveCheckpoint(tx, checkpoint))
  let restartedMissingCursor = false
  const now = new Date()
  const purgeCutoff = new Date(now.getTime() - MEMBER_SUSPENDED_PURGE_DAYS * 24 * 60 * 60 * 1000)
  const counts = { credentials: 0, inserted: 0, changed: 0, removed: 0 }
  while (checkpoint.phase === 'listing') {
    if (Date.now() >= run.deadlineAt) return false
    await run.lease.beatIfDue()
    let page: Awaited<ReturnType<typeof listKnowledgeConnectorMemberCredentials>>
    try {
      page = await listKnowledgeConnectorMemberCredentials({
        workspaceId: run.workspaceId,
        organizationId: run.organizationId,
        ...binding,
        connectorId: run.connectorId,
        limit: MEMBER_CREDENTIAL_PAGE_SIZE,
        cursor: checkpoint.cursor ?? undefined,
      })
    } catch (error) {
      if (
        !(error instanceof CredentialGroupCredentialCursorNotFoundError) ||
        !checkpoint.cursor ||
        restartedMissingCursor
      )
        throw error
      checkpoint = { ...checkpoint, cursor: null }
      restartedMissingCursor = true
      await withMemberLease(run, (tx) => saveCheckpoint(tx, checkpoint))
      continue
    }
    if (page.nextCursor && page.nextCursor === checkpoint.cursor)
      throw new Error('Credential directory pagination did not advance')
    const next: DirectoryCheckpoint = {
      ...checkpoint,
      cursor: page.nextCursor,
      phase: page.nextCursor ? 'listing' : 'cleanup',
    }
    const snapshots = page.credentials.map(
      (entry): MemberCredentialSnapshot => ({
        credentialId: entry.credentialId,
        subjectToken: subjectToken(entry),
        active: deriveMemberActive(entry, optionState),
      })
    )
    counts.credentials += snapshots.length
    await withMemberLease(run, async (tx) => {
      if (snapshots.length > 0) {
        const existing = await tx
          .select()
          .from(knowledgeConnectorMember)
          .where(
            and(
              eq(knowledgeConnectorMember.connectorId, run.connectorId),
              inArray(
                knowledgeConnectorMember.credentialId,
                snapshots.map((entry) => entry.credentialId)
              )
            )
          )
        const existingByCredential = new Map(existing.map((row) => [row.credentialId, row]))
        const inserts: (typeof knowledgeConnectorMember.$inferInsert)[] = []
        for (const snapshot of snapshots) {
          const row = existingByCredential.get(snapshot.credentialId)
          const status = snapshot.active ? 'active' : 'suspended'
          if (!row) {
            inserts.push({
              id: generateId(),
              workspaceId: run.workspaceId,
              organizationId: run.organizationId,
              connectorId: run.connectorId,
              credentialId: snapshot.credentialId,
              subjectToken: snapshot.subjectToken,
              status,
              suspendedAt: snapshot.active ? null : now,
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
            if (!membershipRewrite(row.listingCheckpoint)?.removeMember) {
              await tx
                .update(knowledgeConnectorMember)
                .set({
                  listingCheckpoint: { kind: 'membership', cursor: null, removeMember: true },
                  updatedAt: now,
                })
                .where(eq(knowledgeConnectorMember.id, row.id))
              counts.removed += 1
            }
            continue
          }
          const tokenChanged = row.subjectToken !== snapshot.subjectToken
          const statusChanged = row.status !== status
          if (!tokenChanged && !statusChanged) continue
          await tx
            .update(knowledgeConnectorMember)
            .set({
              subjectToken: snapshot.subjectToken,
              status,
              listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false },
              suspendedAt: snapshot.active ? null : (row.suspendedAt ?? now),
              /** New identities cannot reuse the previous account's permission listing. */
              ...(tokenChanged || (statusChanged && snapshot.active)
                ? {
                    nextAttemptAt: now,
                    consecutiveFailures: 0,
                    changeCursor: null,
                    memberSyncedThrough: null,
                    lastCompleteListingAt: null,
                    lastListedCount: null,
                  }
                : {}),
              updatedAt: now,
            })
            .where(eq(knowledgeConnectorMember.id, row.id))
          counts.changed += 1
        }
        if (inserts.length > 0) {
          await tx.insert(knowledgeConnectorMember).values(inserts).onConflictDoNothing()
          counts.inserted += inserts.length
        }
      }
      await saveCheckpoint(tx, next)
    })
    checkpoint = next
  }

  /** Only a complete enumeration permits removing members whose credential left this option. */
  for (;;) {
    if (Date.now() >= run.deadlineAt) return false
    await run.lease.beatIfDue()
    const removed = await withMemberLease(run, async (tx) => {
      const rows = await tx
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, run.connectorId),
            sql`coalesce(${knowledgeConnectorMember.listingCheckpoint}->>'removeMember', 'false') <> 'true'`,
            notExists(
              tx
                .select({ id: credential.id })
                .from(credential)
                .innerJoin(
                  credentialGroupEnrollment,
                  eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
                )
                .where(
                  and(
                    eq(credential.id, knowledgeConnectorMember.credentialId),
                    resourceScopeCondition(credential, resourceScopeFromOwner(run)),
                    eq(credential.type, 'managed_oauth'),
                    eq(credential.credentialGroupOptionId, binding.credentialGroupOptionId),
                    eq(credentialGroupEnrollment.credentialGroupId, binding.credentialGroupId)
                  )
                )
            )
          )
        )
        .orderBy(asc(knowledgeConnectorMember.id))
        .limit(500)
      if (rows.length > 0)
        await tx
          .update(knowledgeConnectorMember)
          .set({
            status: 'suspended',
            suspendedAt: now,
            listingCheckpoint: { kind: 'membership', cursor: null, removeMember: true },
            updatedAt: now,
          })
          .where(
            and(
              eq(knowledgeConnectorMember.connectorId, run.connectorId),
              inArray(
                knowledgeConnectorMember.id,
                rows.map((row) => row.id)
              )
            )
          )
      return rows.length
    })
    counts.removed += removed
    if (removed === 0) break
  }
  logger.info('Reconciled members-mode membership', {
    connectorId: run.connectorId,
    ...counts,
    groupActive: optionState.groupActive,
    optionActive: optionState.optionActive,
  })
  if (!(await resumeMembershipRewrites(run))) return false
  await withMemberLease(run, (tx) =>
    saveCheckpoint(tx, { ...checkpoint, phase: 'complete', cursor: null })
  )
  return true
}

/**
 * Claims the next due member for this run. Sequential by design: one member
 * at a time keeps first-writer-wins deterministic and lets a single huge
 * member be aborted at the deadline without touching the others.
 */
async function claimNextMember(run: MemberSyncRun): Promise<MemberRow | null> {
  /**
   * Proved under the lease: a run reclaimed while it slept must not stamp
   * `lastStartedAt`, which would hide the member from its replacement's
   * selection and defer that member's access updates to a later run.
   */
  const [claimed] = await db.transaction(async (tx) => {
    await assertSyncLeaseHeldInTx(tx, run.connectorId, run.lease)
    return tx
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
  })
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
async function countDueMembers(
  run: MemberSyncRun,
  binding: { credentialGroupOptionId: string }
): Promise<number> {
  const [due] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeConnectorMember)
    .where(
      and(
        eq(knowledgeConnectorMember.connectorId, run.connectorId),
        eq(knowledgeConnectorMember.status, 'active'),
        lte(knowledgeConnectorMember.nextAttemptAt, new Date())
      )
    )
  /** An account that connected while this run was listing has no member row yet. */
  const [unenrolled] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(credential)
    .where(
      and(
        resourceScopeCondition(credential, resourceScopeFromOwner(run)),
        eq(credential.credentialGroupOptionId, binding.credentialGroupOptionId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.managedOauthStatus, 'active'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(knowledgeConnectorMember)
            .where(
              and(
                eq(knowledgeConnectorMember.connectorId, run.connectorId),
                eq(knowledgeConnectorMember.credentialId, credential.id)
              )
            )
        )
      )
    )
  if ((unenrolled?.count ?? 0) > 0) {
    await withMemberLease(run, (tx) =>
      tx
        .update(knowledgeConnector)
        .set({ directoryCheckpoint: null })
        .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
    )
  }
  return (due?.count ?? 0) + (unenrolled?.count ?? 0)
}

async function recordMemberFailure(
  run: MemberSyncRun,
  member: MemberRow,
  error: unknown,
  syncIntervalMinutes: number,
  credentialRejected = false
): Promise<void> {
  const failures = member.consecutiveFailures + 1
  await withMemberLease(run, async (tx) => {
    if (credentialRejected)
      await tx
        .update(knowledgeConnector)
        .set({ directoryCheckpoint: null })
        .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
    await tx
      .update(knowledgeConnectorMember)
      .set({
        ...(credentialRejected
          ? {
              status: 'suspended',
              suspendedAt: new Date(),
              listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false },
              changeCursor: null,
              memberSyncedThrough: null,
              lastCompleteListingAt: null,
            }
          : {}),
        consecutiveFailures: failures,
        nextAttemptAt: new Date(Date.now() + memberFailureBackoffMs(failures, syncIntervalMinutes)),
        lastError: getErrorMessage(error),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnectorMember.id, member.id))
  })
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
  checkpoint?: ListingCheckpoint
  observationRunId?: string
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
  processPage: (documents: ExternalDocument[], checkpoint: ListingCheckpoint) => Promise<void>
}): Promise<MemberListing | { kind: 'failed' }> {
  const { run, member, connectorConfig, sourceConfig, syncContext } = input
  const startedAt = new Date()
  const feed = supportsChangeFeed(connectorConfig, sourceConfig)
  const feedOpen = feed && Boolean(member.changeCursor)
  const full =
    (!feed && !connectorConfig.supportsIncrementalSync) ||
    connectorConfig.supportsChangeFeed?.(sourceConfig) === false ||
    Boolean(member.listingCheckpoint) ||
    member.lastError === SOURCE_CONTENT_ERROR ||
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
      const complete = pass.exhausted
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

    const fingerprint = listingFingerprint({
      connectorType: connectorConfig.id,
      sourceConfig,
      credentialId: member.credentialId,
      subjectToken: member.subjectToken,
    })
    let checkpoint = readListingCheckpoint(member.listingCheckpoint, fingerprint)
    if (checkpoint?.incrementalSince && !feed && !connectorConfig.supportsIncrementalSync) {
      checkpoint = null
    }
    if (!checkpoint) {
      const openedCursor =
        full && feed
          ? await connectorConfig.getChangeCursor(
              await input.tokens.get(member.id),
              sourceConfig,
              syncContext
            )
          : undefined
      checkpoint = beginListingCheckpoint({
        fingerprint,
        generationId: run.runId,
        startedAt,
        changeCursor: openedCursor,
        incrementalSince:
          full || !member.memberSyncedThrough
            ? undefined
            : new Date(member.memberSyncedThrough.getTime() - INCREMENTAL_OVERLAP_MS),
      })
      await withMemberLease(run, (tx) =>
        tx
          .update(knowledgeConnectorMember)
          .set({ listingCheckpoint: checkpoint })
          .where(eq(knowledgeConnectorMember.id, member.id))
      )
    }
    checkpoint = await runResumableListing({
      connectorConfig,
      sourceConfig,
      syncContext,
      checkpoint,
      deadlineAt: run.deadlineAt,
      beforePage: run.lease.beatIfDue,
      getAccessToken: () => input.tokens.get(member.id),
      processPage: async (documents, checkpoint) => {
        await input.processPage(documents, checkpoint)
      },
      saveCheckpoint: (next) =>
        withMemberLease(run, (tx) =>
          tx
            .update(knowledgeConnectorMember)
            .set({ listingCheckpoint: next })
            .where(eq(knowledgeConnectorMember.id, member.id))
        ).then(() => undefined),
    })
    return {
      kind: 'listed',
      mode: checkpoint.incrementalSince ? 'incremental' : 'full',
      documents: [],
      removedExternalIds: [],
      complete: checkpoint.complete && !checkpoint.unsafe,
      resumable: !checkpoint.complete,
      authoritative: false,
      startedAt: new Date(checkpoint.startedAt),
      changeCursor: checkpoint.complete && !checkpoint.unsafe ? checkpoint.changeCursor : undefined,
      checkpoint,
      observationRunId: checkpoint.generationId,
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
    const credentialRejected =
      connectorConfig.isCredentialInvalidError?.(error) === true &&
      (await input.tokens.reject(member.id))
    await recordMemberFailure(
      input.run,
      member,
      error,
      input.syncIntervalMinutes,
      credentialRejected
    )
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
  let removesAllowed = outcome.mode === 'full' && outcome.complete && !outcome.suspect
  const now = new Date()

  if (removesAllowed) {
    for (;;) {
      if (Date.now() >= run.deadlineAt) {
        removesAllowed = false
        outcome.complete = false
        outcome.resumable = true
        break
      }
      await run.lease.beatIfDue()
      const batch = await withMemberLease(run, (tx) =>
        removeUnseenMemberObservations(
          tx,
          outcome.member.id,
          outcome.observationRunId ?? run.runId,
          async (removed) => {
            await materializeDocumentAcls(run.connectorId, removed, tx)
          }
        )
      )
      run.result.observationsRemoved += batch.removed
      if (batch.finished) break
    }
  }

  await withMemberLease(run, async (tx) => {
    const added = await recordMemberObservations(
      tx,
      outcome.member.id,
      seenDocumentIds,
      outcome.observationRunId ?? run.runId
    )
    run.result.observationsAdded += added
    /**
     * Every seen document is rematerialised, not only the newly observed ones:
     * a run that died between writing observations and writing ACLs left them
     * hidden, and the observation graph is the only record that says so.
     * Rematerialising an already-correct ACL is a no-op write.
     */
    for (const documentId of seenDocumentIds) affected.add(documentId)
    if (outcome.mode === 'changes') {
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
        lastError: outcome.contentFailures ? SOURCE_CONTENT_ERROR : null,
        ...(outcome.mode === 'full' &&
        (!outcome.checkpoint || (outcome.checkpoint.complete && !outcome.checkpoint.unsafe))
          ? { lastListedCount: outcome.listedCount }
          : {}),
        nextAttemptAt: outcome.resumable ? now : memberNextAttemptAt(now, syncIntervalMinutes),
        ...(removesAllowed
          ? { lastCompleteListingAt: now, memberSyncedThrough: outcome.listingStartedAt }
          : {}),
        ...(outcome.mode === 'changes' && outcome.complete
          ? { memberSyncedThrough: outcome.listingStartedAt }
          : {}),
        ...(outcome.changeCursor !== undefined ? { changeCursor: outcome.changeCursor } : {}),
        ...(!outcome.resumable &&
        (outcome.checkpoint?.complete || (outcome.mode === 'full' && outcome.complete))
          ? { listingCheckpoint: null }
          : {}),
        updatedAt: now,
      })
      .where(eq(knowledgeConnectorMember.id, outcome.member.id))
  })

  if (outcome.complete) run.result.membersCompleted += 1
  else run.result.membersIncomplete += 1
  return affected
}

async function loadDocumentIdsByExternalId(
  connectorId: string,
  externalIds: readonly string[]
): Promise<Map<string, string>> {
  const corpus = await loadPageCorpus(connectorId, externalIds)
  return new Map(
    [...corpus.priorByExternalId]
      .filter(([, row]) => !row.userExcluded)
      .map(([externalId, row]) => [externalId, row.id])
  )
}

/**
 * Supplies the member connector's corpus from its dedicated credential. The
 * shared content pass owns hydration and removal; member observations only own
 * visibility. A completed content log provides the same consecutive-listing
 * evidence used by ordinary connector deletion guards.
 */
async function syncDedicatedMemberContent(input: {
  run: MemberSyncRun
  connector: typeof knowledgeConnector.$inferSelect
  connectorConfig: ConnectorConfig
  sourceConfig: Record<string, unknown>
  kbOwner: KnowledgeBaseOwner
  billingAttribution: BillingAttributionSnapshot
}) {
  const { run, connector, connectorConfig, sourceConfig, kbOwner } = input
  const userId = await resolveConnectorTokenUserId({
    credentialId: connector.credentialId,
    workspaceId: run.workspaceId,
    organizationId: run.organizationId,
    fallbackUserId: kbOwner.userId,
  })
  if (!userId) throw new Error('The content credential is no longer available in this workspace')
  const resolveToken = async () => {
    const token = await resolveConnectorAccessToken({
      auth: connectorConfig.auth,
      connector,
      userId,
      requestId: run.runId,
      sourceConfig,
    })
    if (!token) throw new Error('The content credential needs to be reconnected')
    return token
  }
  let token = await resolveToken()
  const syncContext: Record<string, unknown> = {
    syncRunId: run.runId,
    ...syncContextForToken(token),
  }
  const refresh = async () => {
    token = await resolveToken()
  }
  const pass = await runConnectorContentPass({
    connectorId: run.connectorId,
    connector,
    connectorConfig,
    sourceConfig,
    syncContext,
    kbOwner,
    billingAttribution: input.billingAttribution,
    result: run.result,
    lease: run.lease,
    documentAccess: 'members',
    forceRehydrate: false,
    /** Content yields half the remaining worker budget to directory and permission refreshes. */
    deadlineAt: Math.floor((Date.now() + run.deadlineAt) / 2),
    runId: run.runId,
    leaseKind: 'member',
    fingerprint: listingFingerprint({
      connectorType: connector.connectorType,
      credentialId: connector.credentialId,
      sourceConfig,
      accessMode: connector.accessMode,
    }),
    getAccessToken: async (pageNum) => {
      if (pageNum > 0) await refresh()
      return token.accessToken
    },
    hydration: {
      beforeHydration: refresh,
      getDocument: (externalId) =>
        connectorConfig.getDocument(token.accessToken, sourceConfig, externalId, syncContext),
    },
  })
  run.result.docsHydratedOnce = pass.hydratedCount
  const incompleteListing =
    !pass.complete || pass.checkpoint.unsafe || pass.checkpoint.contentFailures
  if (pass.checkpoint.contentFailures) run.result.listingIncomplete = true
  const contentNotice = pass.holdNotice
  await withMemberLease(run, async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(document)
      .where(
        and(
          eq(document.connectorId, run.connectorId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
    const now = new Date()
    await tx.insert(knowledgeConnectorSyncLog).values({
      id: run.runId,
      connectorId: run.connectorId,
      status: incompleteListing ? 'partial' : 'completed',
      errorMessage: contentNotice,
      startedAt: run.runStartedAt,
      completedAt: now,
      listedCount: pass.complete ? pass.checkpoint.listedCount : null,
      docsAdded: run.result.docsAdded,
      docsUpdated: run.result.docsUpdated,
      docsDeleted: run.result.docsDeleted,
      docsUnchanged: run.result.docsUnchanged,
      docsSkipped: run.result.docsSkipped,
      docsFailed: run.result.docsFailed,
    })
    await tx
      .update(knowledgeConnector)
      .set({
        ...(run.result.docsFailed === 0 && !incompleteListing
          ? { lastSyncAt: new Date(pass.checkpoint.startedAt) }
          : {}),
        ...(pass.complete ? { listingCheckpoint: null } : {}),
        lastSyncDocCount: count,
        lastSyncError: contentNotice,
        updatedAt: now,
      })
      .where(stillHoldsMemberSyncLock(run.connectorId, run.runId))
  })
  return { complete: pass.complete }
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
        status:
          result.listingIncomplete ||
          result.membersRemaining ||
          result.membersIncomplete > 0 ||
          result.membersFailed > 0 ||
          result.docsFailed > 0 ||
          result.processingDispatch.failed > 0
            ? 'partial'
            : 'completed',
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
        ...(!result.membersRemaining ? { directoryCheckpoint: null } : {}),
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
 * Ends a run without doing anything because the feature is not available to
 * the workspace right now. The connector keeps its members and their
 * observations, and its failure ladder does not advance; the reason is left
 * on the connector and the run's log so an admin can see why nothing syncs.
 * It is looked at again on its next schedule; a manual-only connector waits
 * for the next manual sync.
 */
async function deferMemberSync(run: MemberSyncRun, syncIntervalMinutes: number): Promise<void> {
  const now = new Date()
  await failMemberSyncLog(run.runId, run.result, 'Per-member access is not available; waiting')
  await db
    .update(knowledgeConnector)
    .set({
      memberSyncStatus: 'idle',
      lastMemberSyncError: 'Per-member access is not available for this workspace',
      nextMemberSyncAt: nextMemberSyncTime(now, syncIntervalMinutes, false),
      memberSyncLockToken: null,
      memberSyncLockLeaseAt: null,
      updatedAt: now,
    })
    .where(holdsMemberSyncLockToken(run.connectorId, run.runId))
  logger.info('Member sync deferred; per-member access is not available', {
    connectorId: run.connectorId,
  })
}

/**
 * Disables member sync on a connector that can no longer run it because its
 * group binding is gone, and suspends every member so their tokens leave
 * every ACL. Nothing is purged: re-enabling restores access from the retained
 * observations.
 */
async function disableMemberSync(run: MemberSyncRun, reason: string): Promise<void> {
  const now = new Date()
  /** Suspension, the ACLs it changes, and the disable itself land together, and only under the lease. */
  await withMemberLease(run, async (tx) => {
    await tx
      .update(knowledgeConnectorMember)
      .set({ status: 'suspended', suspendedAt: now, updatedAt: now })
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, run.connectorId),
          eq(knowledgeConnectorMember.status, 'active')
        )
      )
    await tx
      .update(document)
      .set({ acl: [], aclRequirements: [], aclVerifiedAt: null })
      .where(eq(document.connectorId, run.connectorId))
    await tx
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
  })
  await failMemberSyncLog(run.runId, run.result, reason)
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
    .select({
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
    })
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
  if (!kbRow.workspaceId && !kbRow.organizationId) {
    throw new Error(
      `Knowledge base ${connectorBeforeLock.knowledgeBaseId} is missing workspace billing context`
    )
  }
  assertBillingAttributionOwner(billingAttribution, kbRow)
  const kbOwner: KnowledgeBaseOwner = {
    workspaceId: kbRow.workspaceId,
    organizationId: kbRow.organizationId,
    userId: kbRow.userId,
  }

  const runId = generateId()
  const connector = await acquireMemberSyncLock(connectorId, runId, options.dispatchToken)
  if (!connector) {
    const [current] = await db
      .select({
        status: knowledgeConnector.status,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        memberSyncLockToken: knowledgeConnector.memberSyncLockToken,
        syncLockToken: knowledgeConnector.syncLockToken,
      })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
      .limit(1)
    if (
      current?.memberSyncStatus === 'disabled' ||
      current?.syncLockToken ||
      (current && !MEMBER_LOCKABLE_CONNECTOR_STATUSES.some((status) => status === current.status))
    ) {
      logger.info('Connector is not accepting member syncs, skipping', {
        connectorId,
        status: current.status,
      })
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
    ...resourceScopeFields(resourceScopeFromOwner(kbRow)),
    runId,
    runStartedAt,
    deadlineAt: runStartedAt.getTime() + MEMBER_SYNC_SOFT_BUDGET_SECONDS * 1000,
    result,
    lease: createMemberSyncLease(connectorId, runId),
  }
  await insertMemberSyncLog(runId, connectorId, runStartedAt)

  try {
    /**
     * Where the feature is off — flag, plan, or a flag read that could not
     * reach its source — nothing changes: readers already see no member-scoped
     * document, and the run waits for the next schedule to look again.
     */
    if (!(await isKnowledgeMemberAccessAvailable(run))) {
      await deferMemberSync(run, connector.syncIntervalMinutes)
      return {
        ...skipped(result, 'connector_not_syncable'),
        error: 'Per-member access is not available for this workspace',
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
    if (connector.credentialId && !connectorConfig.supportsSeparateContentCredential) {
      throw new Error(`${connectorConfig.name} does not support a separate content credential`)
    }
    const binding = {
      credentialGroupId: connector.credentialGroupId,
      credentialGroupOptionId: connector.credentialGroupOptionId,
    }
    const sourceConfig = connector.sourceConfig as Record<string, unknown>

    if (connector.accessRewritePending && !(await finishPendingAccessRewrite(run))) {
      /** The rewrite is not done, so nothing is listed yet; the next run picks it up at once. */
      result.membersRemaining = true
      const landed = await completeMemberSync(run, connector.syncIntervalMinutes)
      if (!landed) return skipped(result, 'sync_superseded')
      logger.info('Member sync spent its budget hiding documents after a mode switch', {
        connectorId,
        runId,
      })
      return result
    }

    const contentDue =
      Boolean(connector.listingCheckpoint) ||
      options.forceContentRefresh ||
      connector.accessRewritePending ||
      !connector.lastSyncAt ||
      connector.syncIntervalMinutes <= 0 ||
      runStartedAt.getTime() - connector.lastSyncAt.getTime() >=
        connector.syncIntervalMinutes * 60_000
    if (connector.credentialId && options.forceContentRefresh) {
      /** An interrupted explicit crawl stays due when its continuation no longer carries the force flag. */
      await withMemberLease(run, (tx) =>
        tx
          .update(knowledgeConnector)
          .set({ lastSyncAt: null, updatedAt: new Date() })
          .where(stillHoldsMemberSyncLock(connectorId, runId))
      )
    }
    const serviceContent = connector.credentialId
      ? contentDue
        ? await syncDedicatedMemberContent({
            run,
            connector,
            connectorConfig,
            sourceConfig,
            kbOwner,
            billingAttribution,
          })
        : { complete: true }
      : undefined
    /**
     * Anyone who joined the workspace since the last run is invited now, so
     * membership grows on its own; the invitation is the only thing they need.
     */
    const invited = run.workspaceId
      ? await inviteWorkspaceMembersToCredentialGroup({
          workspaceId: run.workspaceId,
          credentialGroupId: connector.credentialGroupId,
          beforeBatch: run.lease.beatIfDue,
          deadlineAt: run.deadlineAt,
        }).catch((error) => {
          logger.warn('Failed to invite new workspace members during a member run', {
            connectorId,
            error: getErrorMessage(error),
          })
          return null
        })
      : null
    if (invited && invited.invited > 0) {
      logger.info('Invited new workspace members to the connector credential group', {
        connectorId,
        ...invited,
      })
    }
    if (
      !(await reconcileMembership(
        run,
        binding,
        connector.directoryCheckpoint,
        Boolean(options.forceContentRefresh)
      ))
    ) {
      result.membersRemaining = true
      if (!(await completeMemberSync(run, connector.syncIntervalMinutes)))
        return skipped(result, 'sync_superseded')
      return result
    }

    const credentialIdByMemberId = new Map<string, string>()
    const tokens = createMemberTokenCache({ run, connectorConfig, credentialIdByMemberId })

    while (Date.now() < run.deadlineAt) {
      const member = await claimNextMember(run)
      if (!member) break
      result.membersClaimed += 1
      credentialIdByMemberId.clear()
      credentialIdByMemberId.set(member.id, member.credentialId)
      const syncContext: Record<string, unknown> = {
        syncRunId: runId,
        memberId: member.id,
        ...PER_MEMBER_LISTING_CONTEXT,
      }
      let contentFailures = false
      const processPage = async (documents: ExternalDocument[], checkpoint: ListingCheckpoint) => {
        const externalIds = documents.map((item) => item.externalId)
        if (!serviceContent) {
          const corpus = await loadPageCorpus(connectorId, externalIds)
          const pageState = createSyncRunState(result)
          const failuresBefore = result.docsFailed
          let rejectedCredentialError: Error | undefined
          const pendingOps = classifyListing({
            externalDocs: documents.filter((item) => {
              const alreadyRead = corpus.priorByExternalId.get(item.externalId)?.sourceSeenAt
              if (
                alreadyRead &&
                alreadyRead >= run.runStartedAt &&
                corpus.priorByExternalId.get(item.externalId)?.contentHash !== null
              ) {
                result.docsUnchanged += 1
                return false
              }
              return true
            }),
            corpus,
            forceRehydrate: false,
            state: pageState,
          })
          result.docsHydratedOnce += pendingOps.filter(
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
            state: pageState,
            hydration: {
              getDocument: async (externalId) => {
                if (rejectedCredentialError) throw rejectedCredentialError
                try {
                  return await connectorConfig.getDocument(
                    await tokens.get(member.id),
                    sourceConfig,
                    externalId,
                    syncContext
                  )
                } catch (error) {
                  if (connectorConfig.isCredentialInvalidError?.(error) === true) {
                    rejectedCredentialError = toError(error)
                    if (await tokens.reject(member.id))
                      await recordMemberFailure(
                        run,
                        member,
                        error,
                        connector.syncIntervalMinutes,
                        true
                      )
                  }
                  throw error
                }
              },
            },
            lease: run.lease,
            documentAccess: 'members',
          })
          if (rejectedCredentialError) throw rejectedCredentialError
          if (result.docsFailed > failuresBefore) {
            await persistSourceDocumentFailures({
              knowledgeBaseId: connector.knowledgeBaseId,
              connectorId,
              connectorType: connector.connectorType,
              documents,
              failedExternalIds: pageState.failedExternalIds,
              priorByExternalId: corpus.priorByExternalId,
              sourceConfig,
              access: 'members',
              lease: run.lease,
            })
            checkpoint.contentFailures = true
            contentFailures = true
            result.listingIncomplete = true
          }
        }
        const documentIds = [
          ...(await loadDocumentIdsByExternalId(connectorId, externalIds)).values(),
        ]
        await withMemberLease(run, async (tx) => {
          result.observationsAdded += await recordMemberObservations(
            tx,
            member.id,
            documentIds,
            checkpoint.generationId
          )
          await materializeDocumentAcls(connectorId, documentIds, tx)
          if (!serviceContent) {
            for (let offset = 0; offset < documentIds.length; offset += 500) {
              await tx
                .update(document)
                .set({ sourceSeenAt: run.runStartedAt })
                .where(
                  and(
                    eq(document.connectorId, connectorId),
                    inArray(document.id, documentIds.slice(offset, offset + 500))
                  )
                )
            }
          }
        })
        result.docsListed += externalIds.length
      }
      const listed = await listForMember({
        run,
        member,
        connectorConfig,
        sourceConfig,
        tokens,
        syncContext,
        syncIntervalMinutes: connector.syncIntervalMinutes,
        forceFull: Boolean(
          serviceContent &&
            (result.docsAdded > 0 ||
              (connector.lastSyncAt &&
                (!member.memberSyncedThrough || member.memberSyncedThrough < connector.lastSyncAt)))
        ),
        processPage,
      })
      if (listed.kind === 'failed') continue
      if (listed.checkpoint?.contentFailures) result.listingIncomplete = true
      if (listed.documents.length > 0) {
        await processPage(
          listed.documents,
          beginListingCheckpoint({
            fingerprint: listingFingerprint({ connectorId, memberId: member.id }),
            generationId: runId,
            startedAt: listed.startedAt,
          })
        )
      }
      const listedCount = listed.checkpoint?.listedCount ?? listed.documents.length
      const suspect =
        listed.mode === 'full' &&
        !listed.authoritative &&
        listed.complete &&
        classifySuspectListing(listedCount, member.lastListedCount ?? 0) !== null
      const outcome: MemberListingOutcome = {
        member,
        mode: listed.mode,
        listingStartedAt: listed.startedAt,
        seenExternalIds: new Set(listed.documents.map((doc) => doc.externalId)),
        removedExternalIds: listed.removedExternalIds,
        listedCount,
        complete: listed.complete,
        resumable: listed.resumable,
        suspect,
        contentFailures: contentFailures || Boolean(listed.checkpoint?.contentFailures),
        changeCursor: suspect ? undefined : listed.changeCursor,
        checkpoint: listed.checkpoint,
        observationRunId: listed.observationRunId,
      }
      const relevantIds = [...outcome.seenExternalIds, ...outcome.removedExternalIds]
      const affected = await applyMemberListing(
        run,
        outcome,
        await loadDocumentIdsByExternalId(connectorId, relevantIds),
        connector.syncIntervalMinutes
      )
      await withMemberLease(run, (tx) => materializeDocumentAcls(connectorId, affected, tx))
    }

    /** A service-owned corpus outlives its last observer; only the content pass removes it. */
    if (!serviceContent) {
      /**
       * Nobody has completed a listing yet — a connector that just entered
       * members mode, waiting for its first member to connect — so an
       * unobserved document says nothing about access and must not be
       * tombstoned, let alone purged a week later.
       */
      const [listed] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(knowledgeConnectorMember)
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, connectorId),
            sql`${knowledgeConnectorMember.lastCompleteListingAt} IS NOT NULL`
          )
        )
      const lifecycle = await applyMemberDocumentLifecycle({
        connectorId,
        knowledgeBaseId: connector.knowledgeBaseId,
        runId,
        lease: run.lease,
        withLease: (fn) => withMemberLease(run, fn),
        deadlineAt: run.deadlineAt,
        allowRemoval: (listed?.count ?? 0) > 0,
      })
      result.docsTombstoned = lifecycle.tombstoned
      result.docsResurrected = lifecycle.resurrected
      result.docsPurged = lifecycle.purged
      result.docsDeleted = lifecycle.purged
      result.membersRemaining = !lifecycle.finished
    }

    await sweepStuckDocuments({
      connectorId,
      knowledgeBaseId: connector.knowledgeBaseId,
      syncStartedAt: runStartedAt,
      retryCutoff: new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      billingAttribution,
      result,
      lease: run.lease,
    })

    result.membersRemaining =
      result.membersRemaining ||
      serviceContent?.complete === false ||
      (await countDueMembers(run, binding)) > 0
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
      await failMemberSyncLog(runId, result, 'Connector deleted during sync').catch((logError) =>
        logger.error('Failed to record member sync failure', {
          connectorId,
          error: getErrorMessage(logError),
        })
      )
      return skipped(result, 'connector_deleted_during_sync')
    }
    if (error instanceof MemberBindingGoneError) {
      try {
        await disableMemberSync(run, error.message)
      } catch (disableError) {
        if (!(disableError instanceof SyncLockLostException)) throw disableError
        logger.warn('Member sync abandoned — lock was reclaimed before it could be disabled', {
          connectorId,
          runId,
        })
        return skipped(result, 'sync_superseded')
      }
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
