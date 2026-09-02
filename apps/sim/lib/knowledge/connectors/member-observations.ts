import { db } from '@sim/db'
import {
  document,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
} from '@sim/db/schema'
import {
  and,
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
} from '@/lib/knowledge/connectors/sync-limits'
import type { SyncRunLease } from '@/lib/knowledge/connectors/sync-lock'
import {
  type ConnectorSyncDeletionGuard,
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

/**
 * Removes every observation of one member that this run did not re-assert.
 * Only called after a full, complete, non-suspect listing: absence from any
 * other kind of listing says nothing about access.
 */
export async function removeUnseenMemberObservations(
  executor: DbOrTx,
  memberId: string,
  runId: string
): Promise<string[]> {
  const removed = await executor
    .delete(knowledgeDocumentObservation)
    .where(
      and(
        eq(knowledgeDocumentObservation.memberId, memberId),
        ne(knowledgeDocumentObservation.runId, runId)
      )
    )
    .returning({ documentId: knowledgeDocumentObservation.documentId })
  return removed.map((row) => row.documentId)
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

/** Every document the given members have observed, for rematerialisation after a membership change. */
export async function listObservedDocumentIds(
  executor: DbOrTx,
  memberIds: readonly string[]
): Promise<string[]> {
  if (memberIds.length === 0) return []
  const rows = await executor
    .selectDistinct({ documentId: knowledgeDocumentObservation.documentId })
    .from(knowledgeDocumentObservation)
    .where(inArray(knowledgeDocumentObservation.memberId, memberIds))
  return rows.map((row) => row.documentId)
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
  options: { deadlineAt?: number; beforeBatch?: () => Promise<void> } = {}
): Promise<boolean> {
  const mismatch =
    target.length === 0
      ? sql`cardinality(${document.acl}) > 0`
      : sql`${document.acl} <> ${textArrayLiteral(target)}`
  for (;;) {
    await options.beforeBatch?.()
    const rewritten = await db
      .update(document)
      .set({ acl: [...target] })
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
      .set({ acl: observedAcl() })
      .where(
        and(
          inArray(document.id, batch),
          eq(document.connectorId, connectorId),
          sql`${document.acl} IS DISTINCT FROM ${observedAcl()}`
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
}

/**
 * The members-mode document lifecycle, applied idempotently every run:
 * a document nobody observes (in any member state) is tombstoned, one that is
 * observed again is resurrected, and one that has stayed unobserved past the
 * purge window is hard deleted under the run's lease. Existence follows the
 * observation graph; visibility follows the active observers through the ACL.
 *
 * A document whose content refresh failed this run is not resurrected: its
 * stored content is known-stale, and surfacing it would show pre-tombstone
 * content as current. It stays tombstoned for a later run to retry.
 */
export async function applyMemberDocumentLifecycle(input: {
  connectorId: string
  knowledgeBaseId: string
  runId: string
  lease: Pick<SyncRunLease, 'beatIfDue'>
  /** Runs the tombstone and resurrection writes only while the run still holds its lease. */
  withLease: <T>(fn: (tx: DbOrTx) => Promise<T>) => Promise<T>
  /** External ids whose refresh did not land this run; withheld from resurrection. */
  failedExternalIds: ReadonlySet<string>
  /**
   * Whether absence of observers may hide or purge a document. False until at
   * least one member has completed a listing: before that, nothing has been
   * observed yet, so absence says nothing.
   */
  allowRemoval: boolean
}): Promise<MemberDocumentLifecycleResult> {
  const { connectorId, knowledgeBaseId, runId } = input
  const now = new Date()

  const { tombstoned, resurrected } = await input.withLease(async (tx) => {
    const tombstoned = !input.allowRemoval
      ? []
      : await tx
          .update(document)
          .set({ deletedAt: now })
          .where(
            and(
              eq(document.connectorId, connectorId),
              eq(document.userExcluded, false),
              isNull(document.archivedAt),
              isNull(document.deletedAt),
              hasNoObservation()
            )
          )
          .returning({ id: document.id })

    const resurrectionCandidates = await tx
      .select({ id: document.id, externalId: document.externalId })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          isNull(document.archivedAt),
          isNotNull(document.deletedAt),
          hasObservation()
        )
      )
    const resurrectIds = resurrectionCandidates
      .filter((row) => !row.externalId || !input.failedExternalIds.has(row.externalId))
      .map((row) => row.id)
    const resurrected =
      resurrectIds.length === 0
        ? []
        : await tx
            .update(document)
            .set({ deletedAt: null })
            .where(
              and(
                inArray(document.id, resurrectIds),
                eq(document.connectorId, connectorId),
                isNull(document.archivedAt),
                isNotNull(document.deletedAt)
              )
            )
            .returning({ id: document.id })
    return { tombstoned, resurrected }
  })

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
  let purged = 0
  const purgeIds = purgeCandidates.map((row) => row.id)
  for (let offset = 0; offset < purgeIds.length; offset += PURGE_CHUNK_SIZE) {
    await input.lease.beatIfDue()
    purged += await hardDeleteDocuments(
      purgeIds.slice(offset, offset + PURGE_CHUNK_SIZE),
      runId,
      connectorId,
      knowledgeBaseId,
      guard
    )
  }

  return { tombstoned: tombstoned.length, resurrected: resurrected.length, purged }
}

export interface StaleMemberSweepResult {
  members: number
  observationsRemoved: number
  documentsRematerialized: number
  docsTombstoned: number
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
 */
export async function sweepStaleMemberObservations(now: Date): Promise<StaleMemberSweepResult> {
  const staleWindow = sql`GREATEST(
    ${MEMBER_OBSERVATION_STALE_AFTER_HOURS} * INTERVAL '1 hour',
    2 * ${knowledgeConnector.syncIntervalMinutes} * INTERVAL '1 minute'
  )`
  const cutoff = sql`${sql.param(now, knowledgeConnectorMember.lastStartedAt)} - ${staleWindow}`
  const staleMembers = await db
    .select({
      id: knowledgeConnectorMember.id,
      connectorId: knowledgeConnectorMember.connectorId,
    })
    .from(knowledgeConnectorMember)
    .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, knowledgeConnectorMember.connectorId))
    .where(
      and(
        eq(knowledgeConnector.accessMode, 'members'),
        /** Only a connector that is meant to be crawling can have stopped crawling. */
        inArray(knowledgeConnector.status, ['active', 'error']),
        gt(knowledgeConnector.syncIntervalMinutes, 0),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
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
    members: staleMembers.length,
    observationsRemoved: 0,
    documentsRematerialized: 0,
    docsTombstoned: 0,
  }
  for (const member of staleMembers) {
    const removed = await db
      .delete(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.memberId, member.id))
      .returning({ documentId: knowledgeDocumentObservation.documentId })
    const documentIds = removed.map((row) => row.documentId)
    result.observationsRemoved += documentIds.length
    result.documentsRematerialized += await materializeDocumentAcls(member.connectorId, documentIds)
    if (documentIds.length > 0) {
      const tombstoned = await db
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
      result.docsTombstoned += tombstoned.length
    }
  }
  return result
}
