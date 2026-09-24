import { createLogger } from '@sim/logger'
import { getTransientDatabaseFailure } from '@sim/utils/errors'
import { sleep as defaultSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

const logger = createLogger('SearchIndexDeletion')

/** Documents per page: each page's documents are deleted, with their storage intents, in one transaction. */
export const DEFAULT_DOCUMENT_PAGE_SIZE = 200

/**
 * Chunks deleted per transaction. Each chunk's delete cascades, by foreign key, to its rows in
 * `embedding_search`, `embedding_keyword_search`, `embedding_keyword_tin` and
 * `embedding_secret_provenance`, so a batch writes about five times this many row deletions.
 * Matches the app's connector cleanup worker.
 */
export const DEFAULT_CHUNK_BATCH_SIZE = 1_000

/** Pause after every committed transaction, so the run shares the database with search. */
export const DEFAULT_PAUSE_MS = 250

/** Pages a dry run walks unless `--max-pages` says otherwise; a dry run only reads. */
export const DEFAULT_DRY_RUN_MAX_PAGES = 3

/**
 * Pending storage cleanup events above which the run waits for the outbox worker before queueing
 * more: every deleted document with a stored object queues one event, and the worker deletes one
 * object per event.
 */
export const DEFAULT_STORAGE_CLEANUP_CEILING = 2_000

/** Wait between checks while the storage cleanup backlog is above its ceiling. */
export const DEFAULT_BACKPRESSURE_WAIT_MS = 30_000

/** Consecutive transient failures (lock or statement timeout, conflict, lost connection) one step may take. */
export const DEFAULT_TRANSIENT_RETRIES = 8

/** How many times a page re-deletes chunks that a late writer committed after its chunk pass. */
const MAX_CHUNK_PASSES_PER_PAGE = 3

const RETRY_BACKOFF = { baseMs: 2_000, maxMs: 60_000 } as const

/** Connector statuses under which neither the content nor the member sync engine may run. */
export const STOPPED_CONNECTOR_STATUSES = ['paused', 'disabled'] as const

export interface SearchIndexKnowledgeBase {
  id: string
  isSearchIndex: boolean
  deletedAt: Date | null
}

export interface SearchIndexConnector {
  id: string
  status: string
  syncLockHeld: boolean
  memberSyncLockHeld: boolean
  deletedAt: Date | null
  detachedAt: Date | null
}

export type DeleteDocumentsOutcome =
  | { kind: 'deleted'; deleted: number; storageCleanupQueued: number }
  | { kind: 'chunks-remain' }

export interface SearchIndexDeletionStore {
  loadKnowledgeBase(knowledgeBaseId: string): Promise<SearchIndexKnowledgeBase | null>
  listConnectors(knowledgeBaseId: string): Promise<SearchIndexConnector[]>
  /** Connector-owned document ids after `afterId`, in id order. */
  nextDocumentPage(knowledgeBaseId: string, afterId: string, limit: number): Promise<string[]>
  /** Chunks of these documents; read only by a dry run. */
  countChunks(documentIds: readonly string[]): Promise<number>
  /** Deletes at most `limit` chunks of these documents in one transaction; returns how many. */
  deleteChunkBatch(documentIds: readonly string[], limit: number): Promise<number>
  /**
   * In one transaction: share-locks the knowledge base and re-checks it is a search index, locks
   * the documents, and, when none has a chunk left, queues their storage cleanup and deletes them.
   */
  deleteDocuments(
    knowledgeBaseId: string,
    documentIds: readonly string[],
    requestId: string
  ): Promise<DeleteDocumentsOutcome>
  /** Pending storage cleanup events, counted up to `cap`. */
  pendingStorageCleanup(cap: number): Promise<number>
  projectionMarkCount(): Promise<number>
  hasConnectorDocuments(knowledgeBaseId: string): Promise<boolean>
  hasStandaloneDocuments(knowledgeBaseId: string): Promise<boolean>
  /**
   * Clears the listing cursors of the base's stopped connectors and of their members, so a resumed
   * connector lists its source from scratch. Returns the connectors and members reset.
   */
  resetConnectorCursors(knowledgeBaseId: string): Promise<{ connectors: number; members: number }>
}

export interface SearchIndexDeletionOptions {
  knowledgeBaseId: string
  execute: boolean
  requestId: string
  pageSize?: number
  chunkBatchSize?: number
  pauseMs?: number
  /** Stop after this many pages; unbounded for an executing run, {@link DEFAULT_DRY_RUN_MAX_PAGES} for a dry run. */
  maxPages?: number
  /** Resume after this document id. */
  afterId?: string
  storageCleanupCeiling?: number
  backpressureWaitMs?: number
  transientRetries?: number
  /** Reset the connectors' listing cursors once no connector-owned document remains. */
  resetConnectors?: boolean
  sleep?: (ms: number) => Promise<void>
}

export interface SearchIndexDeletionSummary {
  executed: boolean
  pages: number
  documentsSeen: number
  documentsDeleted: number
  chunksDeleted: number
  /** Chunks counted by a dry run on the pages it walked. */
  chunksCounted: number
  storageCleanupQueued: number
  /** The last document id reached; pass it as `--after-id` to resume. */
  afterId: string
  /** Whether every connector-owned document after the starting cursor was reached. */
  done: boolean
  connectorsReset: { connectors: number; members: number } | null
  standaloneDocumentsRemain: boolean | null
  projectionMarks: { before: number; after: number }
}

/** A precondition failed, before the run or before one of its pages; nothing after the check is written. */
export class SearchIndexDeletionRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(`Refusing to delete search index documents: ${reasons.join('; ')}`)
    this.name = 'SearchIndexDeletionRefused'
  }
}

/**
 * Why deleting this base's documents is unsafe now, or an empty list. The base must be an
 * organization search index. Every connector that can still write documents — not deleted and not
 * detached — must be stopped, and no sync of either engine may hold its lease: a running sync
 * would write documents behind the cursor. A detached connector is refused outright, because its
 * worker is converting the same documents into standalone uploads.
 */
export function evaluateDeletionGuard(
  knowledgeBase: SearchIndexKnowledgeBase | null,
  connectors: readonly SearchIndexConnector[]
): string[] {
  if (!knowledgeBase) return ['knowledge base not found']
  const reasons: string[] = []
  if (!knowledgeBase.isSearchIndex) {
    reasons.push('knowledge base is not an organization search index (is_search_index = false)')
  }
  for (const connector of connectors) {
    if (connector.deletedAt) continue
    if (connector.detachedAt) {
      reasons.push(`connector ${connector.id} is detached and still releasing documents`)
      continue
    }
    if (!(STOPPED_CONNECTOR_STATUSES as readonly string[]).includes(connector.status)) {
      reasons.push(`connector ${connector.id} is ${connector.status}, not paused or disabled`)
    }
    if (connector.syncLockHeld) reasons.push(`connector ${connector.id} holds a content sync lease`)
    if (connector.memberSyncLockHeld) {
      reasons.push(`connector ${connector.id} holds a member sync lease`)
    }
  }
  return reasons
}

/**
 * Runs `step`, retrying transient database failures in place with backoff. A step either commits
 * whole or not at all, so a retry repeats nothing that committed.
 */
async function withTransientRetry<T>(
  label: string,
  step: () => Promise<T>,
  retries: number,
  sleep: (ms: number) => Promise<void>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      const failure = getTransientDatabaseFailure(error)
      if (!failure || attempt > retries) throw error
      const delayMs = backoffWithJitter(attempt, null, RETRY_BACKOFF)
      logger.warn('Transient database failure; retrying', {
        step: label,
        failure,
        attempt,
        retryInMs: Math.round(delayMs),
      })
      await sleep(delayMs)
    }
  }
}

async function assertGuard(store: SearchIndexDeletionStore, knowledgeBaseId: string) {
  const [knowledgeBase, connectors] = await Promise.all([
    store.loadKnowledgeBase(knowledgeBaseId),
    store.listConnectors(knowledgeBaseId),
  ])
  const reasons = evaluateDeletionGuard(knowledgeBase, connectors)
  if (reasons.length > 0) throw new SearchIndexDeletionRefused(reasons)
  return { knowledgeBase: knowledgeBase as SearchIndexKnowledgeBase, connectors }
}

/**
 * Deletes a search index's connector-owned documents and their chunks in resumable pages.
 *
 * Each page takes the next documents after the cursor in id order, deletes their chunks in
 * bounded transactions, then deletes the documents in one transaction that also commits their
 * storage cleanup intents, as the app's connector cleanup worker does. A delete marks nothing in
 * `knowledge_projection_dirty` and fires no projection trigger: the projections' rows go by
 * foreign-key cascade in the deleting statement. The guard is re-read before every page, so
 * resuming a connector mid-run stops the run before its next page.
 *
 * Standalone uploads (`connector_id IS NULL`) are never selected; they carry billed storage that
 * only the app's document deletion settles, and the summary reports whether any remain.
 */
export async function deleteSearchIndexDocuments(
  store: SearchIndexDeletionStore,
  options: SearchIndexDeletionOptions
): Promise<SearchIndexDeletionSummary> {
  const pageSize = options.pageSize ?? DEFAULT_DOCUMENT_PAGE_SIZE
  const chunkBatchSize = options.chunkBatchSize ?? DEFAULT_CHUNK_BATCH_SIZE
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS
  const maxPages = options.maxPages ?? (options.execute ? undefined : DEFAULT_DRY_RUN_MAX_PAGES)
  const ceiling = options.storageCleanupCeiling ?? DEFAULT_STORAGE_CLEANUP_CEILING
  const backpressureWaitMs = options.backpressureWaitMs ?? DEFAULT_BACKPRESSURE_WAIT_MS
  const retries = options.transientRetries ?? DEFAULT_TRANSIENT_RETRIES
  const sleep = options.sleep ?? defaultSleep
  const { knowledgeBaseId, execute } = options
  const pause = async () => {
    if (pauseMs > 0) await sleep(pauseMs)
  }
  const retry = <T>(label: string, step: () => Promise<T>) =>
    withTransientRetry(label, step, retries, sleep)

  const { knowledgeBase, connectors } = await assertGuard(store, knowledgeBaseId)
  const marksBefore = await store.projectionMarkCount()
  logger.info(execute ? 'Deleting search index documents' : 'Dry run: nothing will be written', {
    knowledgeBaseId,
    knowledgeBaseDeleted: Boolean(knowledgeBase.deletedAt),
    connectors: connectors.map((connector) => ({
      id: connector.id,
      status: connector.status,
      deleted: Boolean(connector.deletedAt),
    })),
    afterId: options.afterId ?? '',
    pageSize,
    chunkBatchSize,
    maxPages: maxPages ?? 'unbounded',
    projectionMarks: marksBefore,
    pendingStorageCleanup: await store.pendingStorageCleanup(ceiling),
  })

  const summary: SearchIndexDeletionSummary = {
    executed: execute,
    pages: 0,
    documentsSeen: 0,
    documentsDeleted: 0,
    chunksDeleted: 0,
    chunksCounted: 0,
    storageCleanupQueued: 0,
    afterId: options.afterId ?? '',
    done: false,
    connectorsReset: null,
    standaloneDocumentsRemain: null,
    projectionMarks: { before: marksBefore, after: marksBefore },
  }
  const startedAt = Date.now()

  while (maxPages === undefined || summary.pages < maxPages) {
    if (summary.pages > 0) await assertGuard(store, knowledgeBaseId)
    if (execute) {
      for (;;) {
        const pending = await store.pendingStorageCleanup(ceiling)
        if (pending < ceiling) break
        logger.info('Storage cleanup backlog at its ceiling; waiting for the outbox worker', {
          pending,
          ceiling,
          waitMs: backpressureWaitMs,
        })
        await sleep(backpressureWaitMs)
      }
    }
    const documentIds = await retry('read document page', () =>
      store.nextDocumentPage(knowledgeBaseId, summary.afterId, pageSize)
    )
    if (documentIds.length === 0) {
      summary.done = true
      break
    }
    summary.documentsSeen += documentIds.length
    const lastId = documentIds[documentIds.length - 1]

    if (!execute) {
      const chunks = await store.countChunks(documentIds)
      summary.chunksCounted += chunks
      summary.pages += 1
      summary.afterId = lastId
      logger.info('Dry run page', {
        page: summary.pages,
        documents: documentIds.length,
        chunks,
        afterId: lastId,
      })
      continue
    }

    let outcome: DeleteDocumentsOutcome = { kind: 'chunks-remain' }
    for (
      let pass = 0;
      pass < MAX_CHUNK_PASSES_PER_PAGE && outcome.kind === 'chunks-remain';
      pass++
    ) {
      for (;;) {
        const deleted = await retry('delete chunk batch', () =>
          store.deleteChunkBatch(documentIds, chunkBatchSize)
        )
        summary.chunksDeleted += deleted
        if (deleted === 0) break
        await pause()
        if (deleted < chunkBatchSize) break
      }
      outcome = await retry('delete documents', () =>
        store.deleteDocuments(knowledgeBaseId, documentIds, options.requestId)
      )
    }
    if (outcome.kind === 'chunks-remain') {
      throw new Error(
        `Chunks kept appearing for documents after ${summary.afterId || '(start)'}; is a writer still indexing this knowledge base?`
      )
    }
    summary.documentsDeleted += outcome.deleted
    summary.storageCleanupQueued += outcome.storageCleanupQueued
    summary.pages += 1
    summary.afterId = lastId
    logger.info('Page deleted', {
      page: summary.pages,
      documents: outcome.deleted,
      storageCleanupQueued: outcome.storageCleanupQueued,
      totalDocuments: summary.documentsDeleted,
      totalChunks: summary.chunksDeleted,
      afterId: lastId,
      elapsedMs: Date.now() - startedAt,
    })
    await pause()
  }

  if (summary.done) {
    summary.standaloneDocumentsRemain = await store.hasStandaloneDocuments(knowledgeBaseId)
    if (summary.standaloneDocumentsRemain) {
      logger.warn(
        'Standalone uploads remain in this knowledge base; delete them through the app so their storage is settled'
      )
    }
    if (execute && options.resetConnectors !== false) {
      if (await store.hasConnectorDocuments(knowledgeBaseId)) {
        logger.warn(
          'Connector documents remain before the starting cursor; rerun without --after-id before connectors are reset'
        )
      } else {
        summary.connectorsReset = await store.resetConnectorCursors(knowledgeBaseId)
        logger.info('Connector listing cursors reset', summary.connectorsReset)
      }
    }
  }
  summary.projectionMarks.after = await store.projectionMarkCount()
  logger.info(
    summary.done
      ? 'Search index deletion reached the end'
      : 'Search index deletion stopped; resume with --after-id',
    {
      ...summary,
      elapsedMs: Date.now() - startedAt,
    }
  )
  return summary
}
