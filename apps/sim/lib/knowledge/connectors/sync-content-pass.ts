import { db } from '@sim/db'
import { document, knowledgeConnector } from '@sim/db/schema'
import { and, asc, eq, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { DbOrTx } from '@/lib/db/types'
import {
  type ConnectorAccessMode,
  effectiveConnectorSyncIntervalMinutes,
} from '@/lib/knowledge/connectors/access-modes'
import {
  createGoogleCompanyScheduler,
  isGoogleCompanySource,
} from '@/lib/knowledge/connectors/google-company-scheduler'
import {
  commitGoogleCompanyWork,
  googleCompanyWorkStore,
} from '@/lib/knowledge/connectors/google-company-store'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
  readListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import {
  SOURCE_CONTENT_ERROR,
  SOURCE_PERMISSION_ERROR,
} from '@/lib/knowledge/connectors/sync-limits'
import { assertSyncLeaseHeldInTx, type SyncRunLease } from '@/lib/knowledge/connectors/sync-lock'
import {
  type KnowledgeBaseOwner,
  persistSourceDocumentFailures,
} from '@/lib/knowledge/connectors/sync-persistence'
import {
  buildReconciliationHoldNotice,
  classifyListing,
  classifySuspectListing,
  createSyncRunState,
  type DocOpHydration,
  evaluateListingSafety,
  loadPageCorpus,
  loadPreviousListingObservation,
  processDocOps,
  resolvePreviousOwnedCount,
  resolveReconciliationDeleteCap,
} from '@/lib/knowledge/connectors/sync-primitives'
import { hardDeleteDocuments } from '@/lib/knowledge/documents/service'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import type { ConnectorConfig, ExternalDocument, SyncResult } from '@/connectors/types'

interface ContentPassInput {
  connectorId: string
  connector: {
    knowledgeBaseId: string
    connectorType: string
    listingCheckpoint?: unknown
    lastSyncDocCount?: number | null
    syncIntervalMinutes?: number
  }
  connectorConfig: ConnectorConfig
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
  kbOwner: KnowledgeBaseOwner
  billingAttribution: BillingAttributionSnapshot
  result: SyncResult
  lease: SyncRunLease
  leaseKind: 'content' | 'member'
  runId: string
  fingerprint: string
  documentAccess: ConnectorAccessMode
  getAccessToken: (pageNum: number) => Promise<string>
  hydration: DocOpHydration
  lastSyncAt?: Date
  forceRehydrate: boolean
  fullSync?: boolean
  deadlineAt: number
  onPage?: (
    documents: ExternalDocument[],
    generationStartedAt: Date
  ) => Promise<{ permissionsIncomplete: boolean } | undefined>
}

/** One durable content cycle shared by content-owned and member-visibility connectors. */
export async function runConnectorContentPass(input: ContentPassInput) {
  const withLease = <T>(fn: (tx: DbOrTx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await assertSyncLeaseHeldInTx(tx, input.connectorId, input.lease)
      return fn(tx)
    })
  const readGenerationStartedAt = async (tx: DbOrTx): Promise<Date> => {
    const [clock] = await tx.execute<{ startedAt: string }>(
      sql`SELECT statement_timestamp()::text AS "startedAt"`
    )
    const startedAt = new Date(clock?.startedAt ?? '')
    if (!Number.isFinite(startedAt.getTime()))
      throw new Error('Could not read the sync database clock')
    return startedAt
  }
  let checkpoint = readListingCheckpoint(input.connector.listingCheckpoint, input.fingerprint)
  /** A Full resync must revisit documents before an ordinary listing's saved cursor. */
  if (!checkpoint || (input.forceRehydrate && !checkpoint.forceRehydrate)) {
    checkpoint = await withLease(async (tx) => {
      const next = beginListingCheckpoint({
        fingerprint: input.fingerprint,
        generationId: input.runId,
        startedAt: await readGenerationStartedAt(tx),
        incrementalSince: input.lastSyncAt,
        forceRehydrate: input.forceRehydrate,
        fullSync: input.fullSync,
      })
      await tx
        .update(knowledgeConnector)
        .set({ listingCheckpoint: next })
        .where(input.lease.stillHeld())
      return next
    })
  }
  let hydratedCount = 0
  const syncIntervalMinutes = effectiveConnectorSyncIntervalMinutes(
    input.documentAccess,
    input.connector.syncIntervalMinutes ?? SIM_SEARCH_SYNC_INTERVAL_MINUTES
  )
  const companyStore = () =>
    googleCompanyWorkStore(
      input.connectorId,
      String(input.syncContext.syncRunId),
      syncIntervalMinutes > 0
    )
  const company = isGoogleCompanySource(input.connector.connectorType, input.syncContext)
    ? createGoogleCompanyScheduler({
        provider: input.connector.connectorType,
        listDocuments: input.connectorConfig.listDocuments,
        isListingCursorInvalidError: input.connectorConfig.isListingCursorInvalidError,
        syncIntervalMinutes,
        store: {
          get: (...args) => companyStore().get(...args),
          next: (...args) => companyStore().next(...args),
          remaining: () => companyStore().remaining(),
        },
      })
    : undefined
  checkpoint = await runResumableListing({
    connectorConfig: company
      ? { ...input.connectorConfig, listDocuments: company.listDocuments }
      : input.connectorConfig,
    sourceConfig: input.sourceConfig,
    syncContext: input.syncContext,
    checkpoint,
    deadlineAt: input.deadlineAt,
    beforePage: input.lease.beatIfDue,
    getGenerationStartedAt: () => withLease(readGenerationStartedAt),
    getAccessToken: input.getAccessToken,
    processPage: async (documents, cycle, page) => {
      const corpus = await loadPageCorpus(
        input.connectorId,
        documents.map((item) => item.externalId)
      )
      if (page.permissionsOnly)
        documents = documents.filter((item) => corpus.priorByExternalId.has(item.externalId))
      const externalIds = documents.map((item) => item.externalId)
      if (page.permissionsOnly) {
        const changed = documents.filter((item) => {
          const prior = corpus.priorByExternalId.get(item.externalId)
          return prior && (!prior.contentHash || prior.contentHash !== item.contentHash)
        })
        /** Revoke stale-body grants while retaining the content crawl's observation for EOF reconciliation. */
        if (changed.length)
          await withLease(async (tx) => {
            for (let offset = 0; offset < changed.length; offset += 500) {
              await tx
                .update(document)
                .set({ acl: [], aclRequirements: [], aclVerifiedAt: null })
                .where(
                  and(
                    eq(document.connectorId, input.connectorId),
                    inArray(
                      document.externalId,
                      changed.slice(offset, offset + 500).map((item) => item.externalId)
                    ),
                    isNull(document.archivedAt)
                  )
                )
            }
          })
      }
      const state = createSyncRunState(input.result)
      const startedAt = new Date(cycle.startedAt)
      const remaining = documents.filter((item) => {
        const prior = corpus.priorByExternalId.get(item.externalId)
        if (page.permissionsOnly) return prior?.contentHash !== item.contentHash
        if (
          !prior?.sourceSeenAt ||
          prior.sourceSeenAt < startedAt ||
          (company && prior.contentHash !== null && prior.contentHash !== item.contentHash)
        )
          return true
        /** A crash after persisting a failed batch must not erase its failure evidence. */
        if (prior.contentHash === null && !corpus.excludedExternalIds.has(item.externalId)) {
          cycle.contentFailures = true
        }
        return false
      })
      const persistAttempted = async (attempted: ExternalDocument[]) => {
        if (attempted.length === 0) return
        if (attempted.some((item) => state.failedExternalIds.has(item.externalId))) {
          await persistSourceDocumentFailures({
            knowledgeBaseId: input.connector.knowledgeBaseId,
            connectorId: input.connectorId,
            connectorType: input.connector.connectorType,
            documents: attempted,
            failedExternalIds: state.failedExternalIds,
            sourceFailures: state.sourceFailures,
            priorByExternalId: corpus.priorByExternalId,
            sourceConfig: input.sourceConfig,
            access: input.documentAccess,
            lease: input.lease,
          })
          cycle.contentFailures = true
        }
        if (page.permissionsOnly) return
        const attemptedIds = attempted.map((item) => item.externalId)
        await withLease(async (tx) => {
          for (let offset = 0; offset < attemptedIds.length; offset += 500) {
            await tx
              .update(document)
              .set({ sourceSeenAt: startedAt })
              .where(
                and(
                  eq(document.connectorId, input.connectorId),
                  inArray(document.externalId, attemptedIds.slice(offset, offset + 500)),
                  isNull(document.archivedAt)
                )
              )
          }
        })
      }
      const pendingOps = classifyListing({
        externalDocs: remaining,
        corpus,
        forceRehydrate: !page.permissionsOnly && cycle.forceRehydrate,
        state,
      })
      const pendingIds = new Set(pendingOps.map((op) => op.extDoc.externalId))
      await persistAttempted(remaining.filter((item) => !pendingIds.has(item.externalId)))
      const finished = await processDocOps({
        ...input,
        corpus,
        state,
        pendingOps,
        forceRehydrate: !page.permissionsOnly && cycle.forceRehydrate,
        onBatchComplete: async (attempted) => {
          hydratedCount += attempted.filter((item) => item.contentDeferred).length
          await persistAttempted(attempted)
        },
      })
      if (!finished) return false
      const permissionCorpus = page.permissionsOnly
        ? await loadPageCorpus(input.connectorId, externalIds)
        : undefined
      const verifiedDocuments = documents.filter((item) => {
        if (!permissionCorpus) return true
        if (state.failedExternalIds.has(item.externalId)) return false
        const stored = permissionCorpus.priorByExternalId.get(item.externalId)
        return Boolean(
          stored?.contentHash &&
            stored.contentHash === item.contentHash &&
            stored.storageKey !== null
        )
      })
      const pageOutcome = await input.onPage?.(
        verifiedDocuments,
        page.permissionsOnly ? (company?.permissionStartedAt() ?? startedAt) : startedAt
      )
      if (pageOutcome?.permissionsIncomplete) cycle.permissionFailures = true
      if (page.permissionsOnly) return
      await withLease(async (tx) => {
        const verified = externalIds.filter((id) => !state.failedExternalIds.has(id))
        for (let offset = 0; offset < verified.length; offset += 500) {
          await tx
            .update(document)
            .set({ deletedAt: null })
            .where(
              and(
                eq(document.connectorId, input.connectorId),
                inArray(document.externalId, verified.slice(offset, offset + 500)),
                isNotNull(document.contentHash),
                isNull(document.archivedAt)
              )
            )
        }
      })
    },
    saveCheckpoint: async (next) => {
      await withLease(async (tx) => {
        const changes = company?.changesFor(next.cursor)
        if (changes)
          await commitGoogleCompanyWork(
            tx,
            input.connectorId,
            next.generationId,
            changes,
            new Date(next.startedAt)
          )
        await tx
          .update(knowledgeConnector)
          .set({ listingCheckpoint: next })
          .where(input.lease.stillHeld())
      })
      company?.didCommit(next.cursor)
    },
  })
  const reconciliation = checkpoint.complete
    ? await reconcileCompletedListing(input, checkpoint, withLease)
    : { finished: false, notice: null }
  return {
    checkpoint,
    complete: checkpoint.complete && reconciliation.finished,
    holdNotice: checkpoint.permissionFailures
      ? SOURCE_PERMISSION_ERROR
      : (reconciliation.notice ?? (checkpoint.contentFailures ? SOURCE_CONTENT_ERROR : null)),
    hydratedCount,
  }
}

/** Reconciles absence only after EOF, with bounded queries and the existing deletion guards. */
async function reconcileCompletedListing(
  input: ContentPassInput,
  checkpoint: ListingCheckpoint,
  withLease: <T>(fn: (tx: DbOrTx) => Promise<T>) => Promise<T>
): Promise<{ finished: boolean; notice: string | null }> {
  if (checkpoint.unsafe || (checkpoint.listingFailures?.count ?? 0) > 0)
    return {
      finished: true,
      notice:
        'Source listing is incomplete; unlisted documents were kept. Check the configured source scope.',
    }
  if (checkpoint.incrementalSince) return { finished: true, notice: null }
  const startedAt = new Date(checkpoint.startedAt)
  const owned = and(
    eq(document.connectorId, input.connectorId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt)
  )
  const seenOrder = sql`COALESCE(${document.sourceSeenAt}, '-infinity'::timestamp)`
  const absent = and(owned, sql`${seenOrder} < ${sql.param(startedAt, document.sourceSeenAt)}`)
  const soft = and(absent, isNull(document.deletedAt))
  const hard = checkpoint.fullSync ? absent : and(absent, lt(document.deletedAt, startedAt))
  /** Text preserves PostgreSQL microseconds; decoding the cursor as Date can repeat a page. */
  type Cursor = { id: string; seenAt: string }
  const loadBatch = (condition: SQL | undefined, limit: number, after?: Cursor) =>
    db
      .select({
        id: document.id,
        seenAt: sql<string>`${seenOrder}::text`,
        deletedAt: document.deletedAt,
      })
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
      .limit(limit)
  const [{ ownedCount, listedCount, softCount, hardCount }] = await db
    .select({
      ownedCount: sql<number>`count(*)::int`,
      listedCount: sql<number>`count(*) FILTER (WHERE ${document.sourceSeenAt} >= ${sql.param(startedAt, document.sourceSeenAt)})::int`,
      softCount: sql<number>`count(*) FILTER (WHERE ${soft})::int`,
      hardCount: sql<number>`count(*) FILTER (WHERE ${hard})::int`,
    })
    .from(document)
    .where(owned)
  let notice: string | null = null
  let allowDeletion = true
  if (classifySuspectListing(listedCount, ownedCount)) {
    const previous = await loadPreviousListingObservation(
      input.connectorId,
      input.runId,
      resolvePreviousOwnedCount(input.connector.lastSyncDocCount, ownedCount)
    )
    allowDeletion = !evaluateListingSafety(listedCount, ownedCount, previous, checkpoint.fullSync)
      .blocked
  }
  const cap = resolveReconciliationDeleteCap(ownedCount)
  const softHeld = !checkpoint.fullSync && softCount > cap
  const hardHeld = !checkpoint.fullSync && hardCount > cap
  if (softHeld || hardHeld)
    notice = buildReconciliationHoldNotice(
      (softHeld ? softCount : 0) + (hardHeld ? hardCount : 0),
      cap,
      ownedCount,
      softHeld,
      hardHeld
    )
  if (input.documentAccess === 'admin') {
    let after: Cursor | undefined
    for (;;) {
      if (Date.now() >= input.deadlineAt) return { finished: false, notice }
      await input.lease.beatIfDue()
      const rows = await loadBatch(and(absent, sql`cardinality(${document.acl}) > 0`), 500, after)
      if (rows.length === 0) break
      await withLease((tx) =>
        tx
          .update(document)
          .set({ acl: [], aclRequirements: [], aclVerifiedAt: null })
          .where(
            and(
              absent,
              inArray(
                document.id,
                rows.map((row) => row.id)
              )
            )
          )
      )
      after = rows.at(-1)
    }
  }
  if (!allowDeletion) return { finished: true, notice }
  if (!checkpoint.fullSync && !softHeld) {
    let after: Cursor | undefined
    for (;;) {
      if (Date.now() >= input.deadlineAt) return { finished: false, notice }
      await input.lease.beatIfDue()
      const rows = await loadBatch(soft, 500, after)
      if (rows.length === 0) break
      const removed = await withLease((tx) =>
        tx
          .update(document)
          .set({ deletedAt: new Date() })
          .where(
            and(
              soft,
              inArray(
                document.id,
                rows.map((row) => row.id)
              )
            )
          )
          .returning({ id: document.id })
      )
      input.result.docsDeleted += removed.length
      after = rows.at(-1)
    }
  }
  if (!hardHeld) {
    let after: Cursor | undefined
    for (;;) {
      if (Date.now() >= input.deadlineAt) return { finished: false, notice }
      await input.lease.beatIfDue()
      const rows = await loadBatch(hard, 25, after)
      if (rows.length === 0) break
      /** Report newly removed documents once; purging existing tombstones is storage cleanup. */
      for (const tombstoned of [false, true]) {
        const ids = rows
          .filter((row) => (row.deletedAt !== null) === tombstoned)
          .map((row) => row.id)
        if (ids.length === 0) continue
        const removed = await hardDeleteDocuments(
          ids,
          input.runId,
          input.connectorId,
          input.connector.knowledgeBaseId,
          {
            connectorId: input.connectorId,
            knowledgeBaseId: input.connector.knowledgeBaseId,
            syncLockToken: input.runId,
            lease: input.leaseKind,
          }
        )
        if (!tombstoned) input.result.docsDeleted += removed
      }
      after = rows.at(-1)
    }
  }
  return { finished: true, notice }
}
