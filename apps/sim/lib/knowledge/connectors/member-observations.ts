import { db } from '@sim/db'
import {
  document,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
} from '@sim/db/schema'
import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { textArrayLiteral } from '@/lib/knowledge/access/predicate'
import {
  MEMBER_OBSERVATION_STALE_AFTER_HOURS,
  MEMBER_PURGE_MAX_PER_RUN,
  MEMBER_TOMBSTONE_PURGE_DAYS,
  MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN,
} from '@/lib/knowledge/connectors/sync-limits'
import {
  assertSyncLeaseHeldInTx,
  connectorIsLive,
  MEMBER_LOCKABLE_CONNECTOR_STATUSES,
  SyncLockLostException,
  type SyncRunLease,
  type SyncWriteLease,
} from '@/lib/knowledge/connectors/sync-lock'
import {
  type ConnectorSyncDeletionGuard,
  ConnectorSyncDeletionGuardError,
  hardDeleteDocuments,
} from '@/lib/knowledge/documents/service'

/** Documents rematerialised per `UPDATE`; keeps each statement's bind list and lock footprint small. */
const MATERIALIZE_BATCH_SIZE = 500
/** Observation rows written per `INSERT`. */
const OBSERVATION_BATCH_SIZE = 500
/** Documents hard-deleted per call, so the lease heartbeat runs between chunks. */
const PURGE_CHUNK_SIZE = 25
/** Members one scheduler tick will sweep; the rest wait for the next tick. */
const STALE_MEMBER_SWEEP_LIMIT = 200

/**
 * The subject-token aggregate that is a members-mode document's ACL. Ordered
 * under the "C" collation so the array matches the code-unit order every other
 * writer of an ACL produces.
 */
function observedAcl() {
  return sql<string[]>`COALESCE((
    SELECT array_agg(${knowledgeConnectorMember.subjectToken} ORDER BY ${knowledgeConnectorMember.subjectToken} COLLATE "C")
    FROM ${knowledgeDocumentObservation}
    JOIN ${knowledgeConnectorMember}
      ON ${knowledgeConnectorMember.id} = ${knowledgeDocumentObservation.memberId}
     AND ${knowledgeConnectorMember.status} = 'active'
    WHERE ${knowledgeDocumentObservation.documentId} = ${document.id}
  ), '{}'::text[])`
}

function observationQuery() {
  return db
    .select({ one: sql`1` })
    .from(knowledgeDocumentObservation)
    .where(eq(knowledgeDocumentObservation.documentId, document.id))
}

function hasNoObservation() {
  return notExists(observationQuery())
}

function hasObservation() {
  return exists(observationQuery())
}

/**
 * Asserts "member M's crawl returned these documents" for this run. Rows that
 * already existed keep their identity and move to this run; the count of rows
 * that did not exist before is what the run reports as observations added.
 */
export async function recordMemberObservations(
  executor: DbOrTx,
  memberId: string,
  documentIds: readonly string[],
  runId: string
): Promise<number> {
  let added = 0
  const now = new Date()
  for (let offset = 0; offset < documentIds.length; offset += OBSERVATION_BATCH_SIZE) {
    const batch = documentIds.slice(offset, offset + OBSERVATION_BATCH_SIZE)
    const written = await executor
      .insert(knowledgeDocumentObservation)
      .values(batch.map((documentId) => ({ documentId, memberId, lastSeenAt: now, runId })))
      .onConflictDoUpdate({
        target: [knowledgeDocumentObservation.documentId, knowledgeDocumentObservation.memberId],
        set: { lastSeenAt: now, runId },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` })
    added += written.filter((row) => row.inserted).length
  }
  return added
}

/** Documents read per page while renewing a member's observations by access scope. */
const RENEWAL_PAGE_SIZE = 1000

/**
 * Drops prefixes covered by a shorter one, so in the sorted remainder the only
 * prefix that can match an id is the greatest one not after it.
 */
function normalizeScopePrefixes(prefixes: readonly string[]): string[] {
  const sorted = [...new Set(prefixes)].filter((prefix) => prefix.length > 0).sort()
  const kept: string[] = []
  for (const prefix of sorted) {
    const previous = kept.at(-1)
    if (previous === undefined || !prefix.startsWith(previous)) kept.push(prefix)
  }
  return kept
}

function inScope(sortedPrefixes: readonly string[], externalId: string): boolean {
  let low = 0
  let high = sortedPrefixes.length - 1
  let candidate: string | undefined
  while (low <= high) {
    const middle = (low + high) >> 1
    if (sortedPrefixes[middle] <= externalId) {
      candidate = sortedPrefixes[middle]
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return candidate !== undefined && externalId.startsWith(candidate)
}

/**
 * Renews one member's observations of the connector's documents under scopes the
 * source still grants them, without relisting each document: access to a scope is
 * access to everything in it. Only observations older than `renewBefore` are
 * touched, and their generation is kept, so a complete listing still withdraws
 * whatever it no longer returns. Observations outside every scope are left to
 * lapse. Stops at `deadlineAt`; a later run resumes from the stale rows left.
 */
export async function renewMemberObservationsInScopes(input: {
  connectorId: string
  memberId: string
  scopePrefixes: readonly string[]
  renewBefore: Date
  deadlineAt: number
  beforeBatch: () => Promise<void>
  withLease: <T>(fn: (tx: DbOrTx) => Promise<T>) => Promise<T>
}): Promise<{ renewed: number; finished: boolean }> {
  const prefixes = normalizeScopePrefixes(input.scopePrefixes)
  let renewed = 0
  if (prefixes.length === 0) return { renewed, finished: true }
  let after: string | undefined
  for (;;) {
    if (Date.now() >= input.deadlineAt) return { renewed, finished: false }
    await input.beforeBatch()
    const page = await db
      .select({
        documentId: knowledgeDocumentObservation.documentId,
        externalId: document.externalId,
      })
      .from(document)
      .innerJoin(
        knowledgeDocumentObservation,
        and(
          eq(knowledgeDocumentObservation.documentId, document.id),
          eq(knowledgeDocumentObservation.memberId, input.memberId)
        )
      )
      .where(
        and(
          eq(document.connectorId, input.connectorId),
          isNull(document.deletedAt),
          isNotNull(document.externalId),
          after === undefined ? undefined : gt(document.externalId, after),
          lt(knowledgeDocumentObservation.lastSeenAt, input.renewBefore)
        )
      )
      .orderBy(asc(document.externalId))
      .limit(RENEWAL_PAGE_SIZE)
    const renewable = page
      .filter((row) => row.externalId !== null && inScope(prefixes, row.externalId))
      .map((row) => row.documentId)
    if (renewable.length > 0) {
      const now = new Date()
      const rows = await input.withLease((tx) =>
        tx
          .update(knowledgeDocumentObservation)
          .set({ lastSeenAt: now })
          .where(
            and(
              eq(knowledgeDocumentObservation.memberId, input.memberId),
              inArray(knowledgeDocumentObservation.documentId, renewable),
              lt(knowledgeDocumentObservation.lastSeenAt, input.renewBefore)
            )
          )
          .returning({ documentId: knowledgeDocumentObservation.documentId })
      )
      renewed += rows.length
    }
    if (page.length < RENEWAL_PAGE_SIZE) return { renewed, finished: true }
    after = page.at(-1)?.externalId ?? undefined
  }
}

/**
 * Removes every observation of one member that this run did not re-assert.
 * Only called after a full, complete, non-suspect listing: absence from any
 * other kind of listing says nothing about access.
 */
export async function removeUnseenMemberObservations(
  executor: DbOrTx,
  memberId: string,
  runId: string,
  onRemoved: (documentIds: string[]) => Promise<void>
): Promise<{ removed: number; finished: boolean }> {
  const unseen = and(
    eq(knowledgeDocumentObservation.memberId, memberId),
    ne(knowledgeDocumentObservation.runId, runId)
  )
  const candidates = executor
    .select({ documentId: knowledgeDocumentObservation.documentId })
    .from(knowledgeDocumentObservation)
    .where(unseen)
    .limit(OBSERVATION_BATCH_SIZE)
  const removed = await executor
    .delete(knowledgeDocumentObservation)
    .where(and(unseen, inArray(knowledgeDocumentObservation.documentId, candidates)))
    .returning({ documentId: knowledgeDocumentObservation.documentId })
  if (removed.length > 0) await onRemoved(removed.map((row) => row.documentId))
  return { removed: removed.length, finished: removed.length < OBSERVATION_BATCH_SIZE }
}

/**
 * Withdraws one member's observations of specific documents: what their
 * change feed reported as deleted or no longer reachable. Returns the ids
 * whose observation actually existed.
 */
export async function removeMemberObservationsForDocuments(
  executor: DbOrTx,
  memberId: string,
  documentIds: readonly string[]
): Promise<string[]> {
  if (documentIds.length === 0) return []
  const removed: string[] = []
  for (let offset = 0; offset < documentIds.length; offset += OBSERVATION_BATCH_SIZE) {
    const batch = documentIds.slice(offset, offset + OBSERVATION_BATCH_SIZE)
    const rows = await executor
      .delete(knowledgeDocumentObservation)
      .where(
        and(
          eq(knowledgeDocumentObservation.memberId, memberId),
          inArray(knowledgeDocumentObservation.documentId, batch)
        )
      )
      .returning({ documentId: knowledgeDocumentObservation.documentId })
    for (const row of rows) removed.push(row.documentId)
  }
  return removed
}

/**
 * Tombstones, among `documentIds`, the connector's live documents that no
 * member other than `memberId` observes: what that member's removal leaves
 * without an observer. Runs in the caller's transaction so the tombstones land
 * with the removal's progress; a document someone observes again later is
 * resurrected by the lifecycle.
 */
export async function tombstoneDocumentsObservedOnlyBy(
  executor: DbOrTx,
  connectorId: string,
  memberId: string,
  documentIds: readonly string[]
): Promise<number> {
  if (documentIds.length === 0) return 0
  const now = new Date()
  let tombstoned = 0
  for (let offset = 0; offset < documentIds.length; offset += OBSERVATION_BATCH_SIZE) {
    const batch = documentIds.slice(offset, offset + OBSERVATION_BATCH_SIZE)
    const rows = await executor
      .update(document)
      .set({ deletedAt: now })
      .where(
        and(
          inArray(document.id, batch),
          eq(document.connectorId, connectorId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          notExists(
            db
              .select({ one: sql`1` })
              .from(knowledgeDocumentObservation)
              .where(
                and(
                  eq(knowledgeDocumentObservation.documentId, document.id),
                  ne(knowledgeDocumentObservation.memberId, memberId)
                )
              )
          )
        )
      )
      .returning({ id: document.id })
    tombstoned += rows.length
  }
  return tombstoned
}

/**
 * Rewrites `document.acl` from the observation graph: the sorted subject
 * tokens of every active observer, or nobody. Scoped to the connector so a
 * document id that was detached or re-owned since it was collected is left
 * alone.
 */
/** Documents rewritten per statement while a mode switch rewrites a connector's ACLs. */
const ACCESS_REWRITE_BATCH_SIZE = 1000

/**
 * Rewrites every document ACL of the connector to `target`, in bounded
 * batches, until done or `deadlineAt` passes. Returns whether every row was
 * rewritten. `beforeBatch` runs ahead of each statement, for a lease heartbeat.
 */
export async function rewriteConnectorAcls(
  connectorId: string,
  target: readonly string[],
  options: {
    deadlineAt?: number
    beforeBatch?: () => Promise<void>
    /**
     * The lease the caller holds on the connector, proved inside each batch's
     * transaction: a heartbeat before the batch only says the lease was held
     * then, and a run reclaimed mid-rewrite must not land an empty ACL over
     * what its replacement has since materialised.
     */
    lease?: SyncWriteLease
  } = {}
): Promise<boolean> {
  const aclMismatch =
    target.length === 0
      ? sql`cardinality(${document.acl}) > 0`
      : sql`${document.acl} <> ${textArrayLiteral(target)}`
  const mismatch = sql`(${aclMismatch} OR ${document.aclRequirements} <> '[]'::jsonb OR ${document.aclVerifiedAt} IS NOT NULL)`
  for (;;) {
    await options.beforeBatch?.()
    const rewritten = await db.transaction(async (tx) => {
      if (options.lease) await assertSyncLeaseHeldInTx(tx, connectorId, options.lease)
      return tx
        .update(document)
        .set({ acl: [...target], aclRequirements: [], aclVerifiedAt: null })
        .where(
          eq(
            document.id,
            sql`ANY(ARRAY(
              SELECT ${document.id} FROM ${document}
              WHERE ${document.connectorId} = ${connectorId} AND ${mismatch}
              LIMIT ${ACCESS_REWRITE_BATCH_SIZE}
            ))`
          )
        )
        .returning({ id: document.id })
    })
    if (rewritten.length < ACCESS_REWRITE_BATCH_SIZE) return true
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) return false
  }
}

export async function materializeDocumentAcls(
  connectorId: string,
  documentIds: Iterable<string>,
  executor: DbOrTx = db
): Promise<number> {
  const ids = [...new Set(documentIds)]
  let updated = 0
  for (let offset = 0; offset < ids.length; offset += MATERIALIZE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + MATERIALIZE_BATCH_SIZE)
    const rows = await executor
      .update(document)
      .set({ acl: observedAcl(), aclRequirements: [], aclVerifiedAt: null })
      .where(
        and(
          inArray(document.id, batch),
          eq(document.connectorId, connectorId),
          sql`(${document.acl} IS DISTINCT FROM ${observedAcl()} OR ${document.aclRequirements} <> '[]'::jsonb OR ${document.aclVerifiedAt} IS NOT NULL)`
        )
      )
      .returning({ id: document.id })
    updated += rows.length
  }
  return updated
}

export interface MemberDocumentLifecycleResult {
  tombstoned: number
  resurrected: number
  purged: number
  finished: boolean
}

interface MemberDocumentLifecycleInput {
  connectorId: string
  knowledgeBaseId: string
  runId: string
  lease: Pick<SyncRunLease, 'beatIfDue'>
  /** Runs the tombstone and resurrection writes only while the run still holds its lease. */
  withLease: <T>(fn: (tx: DbOrTx) => Promise<T>) => Promise<T>
  deadlineAt: number
  /**
   * Whether absence of observers may hide or purge a document the run has no
   * explicit word on. False until at least one member has completed a listing:
   * before that, nothing has been observed yet, so absence says nothing.
   */
  allowRemoval: boolean
  /**
   * Documents whose observations this run removed. Each is tombstoned if it has
   * no observer left, whether or not `allowRemoval` holds: a removal is the
   * source's or the directory's explicit word, not an absence, just as the
   * stale-member sweep tombstones what it removes. Absence arising any other
   * way is found by the resumable reconcile.
   */
  unobservedDocumentIds: Iterable<string>
}

/** A live, eligible document of the connector that nobody observes: what a tombstone removes. */
function unobservedLiveDocument(connectorId: string) {
  return and(
    eq(document.connectorId, connectorId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    hasNoObservation()
  )
}

/** The order of `doc_connector_reconciliation_idx`, which the resurrection pages walk. */
const seenOrder = sql`COALESCE(${document.sourceSeenAt}, '-infinity'::timestamp)`

type TombstoneCursor = NonNullable<
  (typeof knowledgeConnector.$inferSelect)['memberTombstoneCursor']
>

/**
 * Tombstones the given documents that nobody observes any more, in bounded
 * batches under the run's lease. Returns false when the deadline stopped it.
 */
async function tombstoneUnobserved(
  input: MemberDocumentLifecycleInput,
  documentIds: readonly string[],
  now: Date,
  result: MemberDocumentLifecycleResult
): Promise<boolean> {
  for (let offset = 0; offset < documentIds.length; offset += MATERIALIZE_BATCH_SIZE) {
    if (Date.now() >= input.deadlineAt) return false
    await input.lease.beatIfDue()
    const batch = documentIds.slice(offset, offset + MATERIALIZE_BATCH_SIZE)
    const changed = await input.withLease((tx) =>
      tx
        .update(document)
        .set({ deletedAt: now })
        .where(and(unobservedLiveDocument(input.connectorId), inArray(document.id, batch)))
        .returning({ id: document.id })
    )
    result.tombstoned += changed.length
  }
  return true
}

/**
 * The backstop for absence the run did not cause itself — a member row
 * deleted by an earlier run, a document restored from exclusion, a connector
 * whose first listing just completed, or a run that stopped between removing
 * observations and tombstoning. Walks the connector's live documents by
 * external id through `doc_connector_external_id_idx`, one page per
 * statement, and checks observations only in the UPDATE over that page's ids:
 * filtering the walk itself by observation lets the LIMIT stop bounding it,
 * and a select-list `EXISTS` can be planned as a hash over every observation.
 * The key never changes for a document, unlike `source_seen_at`, which every
 * listing rewrites: a walk ordered by it would chase the documents each run
 * re-stamps and never reach the end of a pass. Resumes from the cursor the
 * previous run saved, so each run's cost is bounded by the page budget rather
 * than the connector's size, and a pass ends within
 * `ceil(live documents / (MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN × 500))`
 * runs; a document that loses its last observer outside a run's own removals
 * is tombstoned within two passes. An unfinished pass does not make the run
 * unfinished: the next scheduled run continues it, rather than re-dispatching
 * back to back. Returns false when the deadline stopped it.
 */
async function reconcileUnobservedPages(
  input: MemberDocumentLifecycleInput,
  now: Date,
  result: MemberDocumentLifecycleResult
): Promise<boolean> {
  const { connectorId } = input
  const [connector] = await db
    .select({ cursor: knowledgeConnector.memberTombstoneCursor })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.id, connectorId))
  let after: TombstoneCursor | null = connector?.cursor ?? null
  let advanced = false
  let finished = true
  for (let page = 0; page < MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN; page++) {
    if (Date.now() >= input.deadlineAt) {
      finished = false
      break
    }
    await input.lease.beatIfDue()
    /**
     * Exclusion and archival are left to the UPDATE so every page is exactly one
     * LIMIT of index entries. `external_id IS NOT NULL` excludes nothing: the
     * only writers that set `connector_id` on a document are the connector sync's
     * inserts (`addDocument`, `buildSkippedDocumentRow`), which copy the
     * `ExternalDocument`'s required `externalId`, and no writer clears it; the
     * two columns were introduced together.
     */
    const rows = await db
      .select({ id: document.id, externalId: document.externalId })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          isNull(document.deletedAt),
          isNotNull(document.externalId),
          after ? gt(document.externalId, after.externalId) : undefined
        )
      )
      .orderBy(asc(document.externalId))
      .limit(MATERIALIZE_BATCH_SIZE)
    if (Date.now() >= input.deadlineAt) {
      finished = false
      break
    }
    if (rows.length > 0) {
      const candidates = rows.map((row) => row.id)
      const changed = await input.withLease((tx) =>
        tx
          .update(document)
          .set({ deletedAt: now })
          .where(and(unobservedLiveDocument(connectorId), inArray(document.id, candidates)))
          .returning({ id: document.id })
      )
      result.tombstoned += changed.length
    }
    advanced = true
    const lastExternalId = rows.at(-1)?.externalId
    after =
      rows.length < MATERIALIZE_BATCH_SIZE || !lastExternalId
        ? null
        : { externalId: lastExternalId }
    if (!after) break
  }
  /** One write per run, not per page: the connector row is hot, and a lost write only repeats pages. */
  if (advanced) {
    const saved = after
    await input.withLease((tx) =>
      tx
        .update(knowledgeConnector)
        .set({ memberTombstoneCursor: saved })
        .where(eq(knowledgeConnector.id, connectorId))
    )
  }
  return finished
}

/**
 * The members-mode document lifecycle, applied idempotently every run:
 * a document nobody observes (in any member state) is tombstoned, one that is
 * observed again is resurrected, and one that has stayed unobserved past the
 * purge window is hard deleted under the run's lease. Existence follows the
 * observation graph; visibility follows the active observers through the ACL.
 *
 * Tombstoning is driven by the documents whose observations this run removed,
 * then, once a member has completed a listing, by a bounded slice of a
 * resumable pass over the whole connector, so a
 * run never evaluates every live document of a large connector in one
 * statement.
 *
 * A document whose content refresh failed this run is not resurrected: its
 * stored content is known-stale, and surfacing it would show pre-tombstone
 * content as current. It stays tombstoned for a later run to retry.
 */
export async function applyMemberDocumentLifecycle(
  input: MemberDocumentLifecycleInput
): Promise<MemberDocumentLifecycleResult> {
  const { connectorId, knowledgeBaseId, runId } = input
  const now = new Date()

  const result: MemberDocumentLifecycleResult = {
    tombstoned: 0,
    resurrected: 0,
    purged: 0,
    finished: false,
  }
  const unobserved = [...new Set(input.unobservedDocumentIds)]
  if (!(await tombstoneUnobserved(input, unobserved, now, result))) return result
  if (input.allowRemoval && !(await reconcileUnobservedPages(input, now, result))) return result

  let after: { id: string; seenAt: string } | undefined
  for (;;) {
    if (Date.now() >= input.deadlineAt) return result
    await input.lease.beatIfDue()
    const condition = and(
      eq(document.connectorId, connectorId),
      eq(document.userExcluded, false),
      isNull(document.archivedAt),
      isNotNull(document.deletedAt),
      isNotNull(document.contentHash),
      hasObservation()
    )
    /** Materialize the limited IDs before UPDATE so its observation check stays batch-bound. */
    const candidates = await db
      .select({ id: document.id, seenAt: sql<string>`${seenOrder}::text` })
      .from(document)
      .where(
        and(
          condition,
          after
            ? sql`(${seenOrder}, ${document.id}) > (${after.seenAt}::timestamp, ${after.id})`
            : undefined
        )
      )
      .orderBy(seenOrder, asc(document.id))
      .limit(MATERIALIZE_BATCH_SIZE)
    if (candidates.length === 0) break
    if (Date.now() >= input.deadlineAt) return result
    const changed = await input.withLease(async (tx) => {
      return tx
        .update(document)
        .set({ deletedAt: null })
        .where(
          and(
            condition,
            inArray(
              document.id,
              candidates.map(({ id }) => id)
            )
          )
        )
        .returning({ id: document.id })
    })
    result.resurrected += changed.length
    after = candidates.at(-1)
    if (candidates.length < MATERIALIZE_BATCH_SIZE) break
  }

  const purgeCutoff = new Date(now.getTime() - MEMBER_TOMBSTONE_PURGE_DAYS * 24 * 60 * 60 * 1000)
  const purgeCandidates = input.allowRemoval
    ? await db
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            eq(document.userExcluded, false),
            isNull(document.archivedAt),
            isNotNull(document.deletedAt),
            lt(document.deletedAt, purgeCutoff),
            hasNoObservation()
          )
        )
        .limit(MEMBER_PURGE_MAX_PER_RUN)
    : []

  const guard: ConnectorSyncDeletionGuard = {
    connectorId,
    knowledgeBaseId,
    syncLockToken: runId,
    lease: 'member',
  }
  const purgeIds = purgeCandidates.map((row) => row.id)
  for (let offset = 0; offset < purgeIds.length; offset += PURGE_CHUNK_SIZE) {
    if (Date.now() >= input.deadlineAt) return result
    await input.lease.beatIfDue()
    try {
      result.purged += await hardDeleteDocuments(
        purgeIds.slice(offset, offset + PURGE_CHUNK_SIZE),
        runId,
        connectorId,
        knowledgeBaseId,
        guard
      )
    } catch (error) {
      /** The deletion guard refusing the lease is a reclaimed run, not a failed one. */
      if (error instanceof ConnectorSyncDeletionGuardError) {
        throw new SyncLockLostException(connectorId)
      }
      throw error
    }
  }

  result.finished = purgeCandidates.length < MEMBER_PURGE_MAX_PER_RUN
  return result
}

export interface StaleMemberSweepResult {
  members: number
  observationsRemoved: number
  documentsRematerialized: number
  docsTombstoned: number
}

/** How long a member's crawls may be silent before the sweep treats them as gone: `max(24 h, 2 × interval)`. */
export function staleMemberWindowMs(syncIntervalMinutes: number): number {
  return Math.max(
    MEMBER_OBSERVATION_STALE_AFTER_HOURS * 60 * 60 * 1000,
    2 * syncIntervalMinutes * 60 * 1000
  )
}

/** The staleness a member is re-checked against once its row is locked; the same clock as the selection. */
function memberStillStale(memberId: string, cutoff: Date) {
  return and(
    eq(knowledgeConnectorMember.id, memberId),
    eq(knowledgeConnectorMember.status, 'active'),
    or(
      isNull(knowledgeConnectorMember.lastStartedAt),
      lt(knowledgeConnectorMember.lastStartedAt, cutoff)
    ),
    or(
      isNull(knowledgeConnectorMember.lastCompleteListingAt),
      lt(knowledgeConnectorMember.lastCompleteListingAt, cutoff)
    )
  )
}

/**
 * Removes the observations of members whose crawls have stopped, so the
 * documents only they observed go dark instead of staying readable forever.
 *
 * Fail-closed but schedule-relative: an active member is swept only when the
 * connector itself completed a run inside `max(24 h, 2 × interval)` while both
 * the member's last start and last complete listing are older than that, so
 * queue lag in a large group, a deferred connector, or one on its failure
 * ladder never trips it. A
 * suspended member is not swept at all: suspension already drops their token
 * from every ACL, and their observations are kept so a re-auth restores access
 * without a re-crawl until membership reconciliation purges the row after
 * `MEMBER_SUSPENDED_PURGE_DAYS`. The member row survives; the next run that
 * lists for them rebuilds their observations. Purging is left to a run holding
 * the lease.
 *
 * Each member is swept in one transaction that first shares the connector row
 * — which a member run holds `FOR UPDATE` while it writes and a mode switch
 * updates when it flips — and then locks the member row, which `claimNextMember`
 * skips while locked. Both are re-checked under those locks, so a run that
 * claimed the member after the selection, or a switch that left members mode,
 * makes the sweep skip rather than delete observations a run just wrote or
 * rewrite ACLs the switch just set.
 */
export async function sweepStaleMemberObservations(now: Date): Promise<StaleMemberSweepResult> {
  const staleWindow = sql`GREATEST(
    ${MEMBER_OBSERVATION_STALE_AFTER_HOURS} * INTERVAL '1 hour',
    2 * ${knowledgeConnector.syncIntervalMinutes} * INTERVAL '1 minute'
  )`
  /**
   * The bound instant is cast: in `$now - GREATEST(...)` Postgres cannot see a
   * timestamp on either side and resolves the subtraction as interval
   * arithmetic, which makes the cutoff an interval and every comparison below
   * fail with "operator does not exist: timestamp > interval".
   */
  const cutoff = sql`${sql.param(now, knowledgeConnectorMember.lastStartedAt)}::timestamp - ${staleWindow}`
  const staleMembers = await db
    .select({
      id: knowledgeConnectorMember.id,
      connectorId: knowledgeConnectorMember.connectorId,
      syncIntervalMinutes: knowledgeConnector.syncIntervalMinutes,
    })
    .from(knowledgeConnectorMember)
    .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, knowledgeConnectorMember.connectorId))
    .where(
      and(
        eq(knowledgeConnector.accessMode, 'members'),
        /** Only a connector that is meant to be crawling can have stopped crawling. */
        inArray(knowledgeConnector.status, MEMBER_LOCKABLE_CONNECTOR_STATUSES),
        gt(knowledgeConnector.syncIntervalMinutes, 0),
        connectorIsLive(),
        /**
         * Only a connector that is still completing runs can have left a member
         * behind; one that is deferred, disabled, or backing off keeps every
         * observation until it runs again.
         */
        ne(knowledgeConnector.memberSyncStatus, 'disabled'),
        gt(knowledgeConnector.lastMemberSyncAt, cutoff),
        exists(
          db
            .select({ one: sql`1` })
            .from(knowledgeDocumentObservation)
            .where(eq(knowledgeDocumentObservation.memberId, knowledgeConnectorMember.id))
        ),
        eq(knowledgeConnectorMember.status, 'active'),
        lt(knowledgeConnectorMember.createdAt, cutoff),
        or(
          isNull(knowledgeConnectorMember.lastStartedAt),
          lt(knowledgeConnectorMember.lastStartedAt, cutoff)
        ),
        or(
          isNull(knowledgeConnectorMember.lastCompleteListingAt),
          lt(knowledgeConnectorMember.lastCompleteListingAt, cutoff)
        )
      )
    )
    .limit(STALE_MEMBER_SWEEP_LIMIT)

  const result: StaleMemberSweepResult = {
    members: 0,
    observationsRemoved: 0,
    documentsRematerialized: 0,
    docsTombstoned: 0,
  }
  for (const member of staleMembers) {
    const memberCutoff = new Date(now.getTime() - staleMemberWindowMs(member.syncIntervalMinutes))
    const swept = await db.transaction(async (tx) => {
      const [connector] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, member.connectorId),
            eq(knowledgeConnector.accessMode, 'members'),
            inArray(knowledgeConnector.status, MEMBER_LOCKABLE_CONNECTOR_STATUSES),
            ne(knowledgeConnector.memberSyncStatus, 'disabled'),
            connectorIsLive()
          )
        )
        .for('share')
      if (!connector) return null
      const [stale] = await tx
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(memberStillStale(member.id, memberCutoff))
        .for('update')
      if (!stale) return null

      const candidates = tx
        .select({ documentId: knowledgeDocumentObservation.documentId })
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, member.id))
        .limit(OBSERVATION_BATCH_SIZE)
      const removed = await tx
        .delete(knowledgeDocumentObservation)
        .where(
          and(
            eq(knowledgeDocumentObservation.memberId, member.id),
            inArray(knowledgeDocumentObservation.documentId, candidates)
          )
        )
        .returning({ documentId: knowledgeDocumentObservation.documentId })
      const documentIds = removed.map((row) => row.documentId)
      const rematerialized = await materializeDocumentAcls(member.connectorId, documentIds, tx)
      const tombstoned =
        documentIds.length === 0
          ? []
          : await tx
              .update(document)
              .set({ deletedAt: now })
              .where(
                and(
                  inArray(document.id, documentIds),
                  eq(document.connectorId, member.connectorId),
                  eq(document.userExcluded, false),
                  isNull(document.archivedAt),
                  isNull(document.deletedAt),
                  hasNoObservation()
                )
              )
              .returning({ id: document.id })
      return {
        observationsRemoved: documentIds.length,
        documentsRematerialized: rematerialized,
        docsTombstoned: tombstoned.length,
      }
    })
    if (!swept) continue
    result.members += 1
    result.observationsRemoved += swept.observationsRemoved
    result.documentsRematerialized += swept.documentsRematerialized
    result.docsTombstoned += swept.docsTombstoned
  }
  return result
}
