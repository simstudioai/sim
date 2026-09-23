import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, getTransientDatabaseFailure } from '@sim/utils/errors'
import type { Sql, TransactionSql } from 'postgres'

const logger = createLogger('KnowledgeProjection')

/**
 * The transaction setting a writer declares to leave its search projection rows to the projector.
 * Unset, which is every writer that predates it, keeps the synchronous triggers; either way the
 * triggers mark the document in `knowledge_projection_dirty`.
 */
const KNOWLEDGE_PROJECTION_MODE_SETTING = 'sim.projection_mode'

/**
 * The expression a knowledge writer selects in its transaction to leave its search projection rows
 * to the projector: `SELECT ${DEFER_KNOWLEDGE_PROJECTION}`. Transaction-local, so a pooled
 * connection never carries it into the next transaction. Writers resolve whether to run it from the
 * `knowledge-async-projection` flag before their transaction begins.
 */
export const DEFER_KNOWLEDGE_PROJECTION = `set_config('${KNOWLEDGE_PROJECTION_MODE_SETTING}', 'async', true)`

/** Whether the current transaction ran {@link DEFER_KNOWLEDGE_PROJECTION}, as trigger SQL reads it. */
export const KNOWLEDGE_PROJECTION_DEFERRED = `current_setting('${KNOWLEDGE_PROJECTION_MODE_SETTING}', true) IS NOT DISTINCT FROM 'async'`

/**
 * The `WHEN` clause of every trigger that writes projection rows in the writer's transaction: it
 * fires unless the transaction deferred them.
 */
export const SYNCHRONOUS_PROJECTION_WHEN = `NOT (${KNOWLEDGE_PROJECTION_DEFERRED})`

/**
 * Search projection rows one statement writes per projection table: a projector page, a page of
 * connector detach releases, and the most chunk rows a page of synchronous ACL assignments may send
 * through the projection trigger. A page always holds at least one document, so a larger one still
 * makes progress alone.
 */
export const PROJECTION_ROW_BATCH_SIZE = 250

/** How long a projector page may wait on a row or index lock before it gives the document up. */
const PROJECTION_PAGE_LOCK_TIMEOUT_MS = 5_000

/** How long a projector page may run before the database cancels it. */
const PROJECTION_PAGE_STATEMENT_TIMEOUT_MS = 60_000

/**
 * How long removing a settled mark may wait. A mark is only row-locked by a writer marking the
 * same document again, which changes its generation, so waiting longer could only end in the
 * same answer: the mark stays.
 */
const SETTLE_LOCK_TIMEOUT_MS = 2_000

/** Marks claimed per round; each is then projected under its own advisory lock. */
const CLAIM_BATCH_SIZE = 50

/** The embedding models trained for prefix retrieval, whose 512 projection is a prefix. */
const SHORTENED_EMBEDDING_MODELS = `('text-embedding-3-small', 'text-embedding-3-large')`

const SEARCH_VECTOR_WIDTHS = [1536, 384, 512, 768, 1024, 3072] as const
const SOURCE_VECTOR_WIDTHS = [1536, 384, 768, 1024, 3072] as const
const widthColumn = (name: string, width: number) => (width === 1536 ? name : `${name}_${width}`)

/** The halfvec columns of `embedding_search`, in width order. */
const SEARCH_VECTOR_COLUMNS = SEARCH_VECTOR_WIDTHS.map((width) => widthColumn('vector', width))

/** The bit columns of `embedding_search`, whose width check requires exactly one. */
const SEARCH_BINARY_COLUMNS = ['"binary"', 'binary_384', 'binary_768', 'binary_1024', 'binary_3072']

/**
 * The halfvec projections of an embedding row, in {@link SEARCH_VECTOR_COLUMNS} order. Shortening
 * is valid only for the two OpenAI models trained for prefix retrieval. These and the bit
 * projections match what `sync_embedding_search()` from `0016_backfill_search_vectors` writes, so
 * a pass over rows a synchronous writer wrote finds nothing to rewrite.
 */
function searchVectorProjections(prefix: string, shortened: string): string {
  return SEARCH_VECTOR_WIDTHS.map((width) =>
    width === 512
      ? `CASE WHEN ${shortened} THEN subvector(coalesce(${SOURCE_VECTOR_WIDTHS.map((size) => `${prefix}.${widthColumn('embedding', size)}`).join(', ')}), 1, 512)::halfvec(512) END`
      : `CASE WHEN NOT (${shortened}) THEN ${prefix}.${widthColumn('embedding', width)}::halfvec(${width}) END`
  ).join(', ')
}

/** The bit projections of an embedding row, in {@link SEARCH_BINARY_COLUMNS} order. */
function searchBinaryProjections(prefix: string): string {
  return `binary_quantize(${prefix}.embedding)::bit(1536), binary_quantize(${prefix}.embedding_384)::bit(384),
    binary_quantize(${prefix}.embedding_768)::bit(768), binary_quantize(${prefix}.embedding_1024)::bit(1024),
    binary_quantize(${prefix}.embedding_3072)::bit(3072)`
}

/** Whether a knowledge base's model is shortened for the 512 projection, for an embedding row. */
function searchVectorShortened(model: string, prefix: string): string {
  return `${model} IN ${SHORTENED_EMBEDDING_MODELS} AND ${prefix}.embedding_384 IS NULL`
}

/** The projections the projector keeps; the Tin projection exists only where `tin` is installed. */
const KNOWLEDGE_PROJECTIONS = [
  'embedding_search',
  'embedding_keyword_search',
  'embedding_keyword_tin',
] as const
export type KnowledgeProjection = (typeof KNOWLEDGE_PROJECTIONS)[number]

/** The projections that mirror their document's source and ACL, and so can be unfilled. */
export const SOURCE_ACL_PROJECTIONS = ['embedding_search', 'embedding_keyword_tin'] as const
export type SourceAclProjection = (typeof SOURCE_ACL_PROJECTIONS)[number]
const mirrorsSourceAcl = (projection: KnowledgeProjection): projection is SourceAclProjection =>
  (SOURCE_ACL_PROJECTIONS as readonly string[]).includes(projection)

/**
 * The chunks one page covers: the next {@link PROJECTION_ROW_BATCH_SIZE} of the document in
 * chunk order, read off `emb_doc_chunk_idx`. Every projection pages the same way, so a page is
 * bounded by chunk rows whatever it writes.
 */
const PAGE = `page AS MATERIALIZED (
    SELECT e.id, e.chunk_index FROM embedding e
    WHERE e.document_id = $1 AND e.chunk_index > $2
    ORDER BY e.chunk_index LIMIT $3
  )`

/** The page's shape as the projector reads it back. */
const PAGE_RESULT = `SELECT (SELECT count(*)::int FROM page) AS scanned,
    (SELECT count(*)::int FROM written) AS written,
    (SELECT max(chunk_index) FROM page) AS last_chunk`

/**
 * Rewrites a page's projection rows from their chunks and the document, writing only the rows
 * that differ, so a document whose rows are already current costs reads and no index writes. The
 * source and ACL are the document's as this statement reads it; a change that commits after it
 * marks the document again, so the projector's settle leaves the mark for the next pass.
 */
function contentPageStatement(projection: KnowledgeProjection): string {
  if (projection === 'embedding_search') {
    const vectors = SEARCH_VECTOR_COLUMNS.join(', ')
    const compared = [
      'knowledge_base_id',
      'document_id',
      'enabled',
      'connector_id',
      'acl',
      ...SEARCH_VECTOR_COLUMNS,
    ]
    return `WITH ${PAGE}, source AS MATERIALIZED (
        SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled, e.embedding, e.embedding_384,
          e.embedding_768, e.embedding_1024, e.embedding_3072,
          ${searchVectorShortened('k.embedding_model', 'e')} AS shortened, d.connector_id, d.acl
        FROM page p JOIN embedding e ON e.id = p.id
        JOIN knowledge_base k ON k.id = e.knowledge_base_id
        JOIN document d ON d.id = e.document_id
      ), written AS (
        INSERT INTO embedding_search AS s
          (id, knowledge_base_id, document_id, enabled, ${SEARCH_BINARY_COLUMNS.join(', ')}, ${vectors},
            connector_id, acl)
        SELECT id, knowledge_base_id, document_id, enabled, ${searchBinaryProjections('source')},
          ${searchVectorProjections('source', 'shortened')}, connector_id, acl
        FROM source
        ON CONFLICT (id) DO UPDATE SET
          ${[...compared, ...SEARCH_BINARY_COLUMNS].map((column) => `${column} = EXCLUDED.${column}`).join(', ')}
        WHERE (${compared.map((column) => `s.${column}`).join(', ')})
          IS DISTINCT FROM (${compared.map((column) => `EXCLUDED.${column}`).join(', ')})
        RETURNING s.id
      ) ${PAGE_RESULT}`
  }
  if (projection === 'embedding_keyword_search') {
    const compared = ['knowledge_base_id', 'document_id', 'enabled', 'content_tsv']
    return `WITH ${PAGE}, written AS (
        INSERT INTO embedding_keyword_search AS s (${['id', ...compared].join(', ')})
        SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled, e.content_tsv
        FROM page p JOIN embedding e ON e.id = p.id
        ON CONFLICT (id) DO UPDATE SET
          ${compared.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}
        WHERE (${compared.map((column) => `s.${column}`).join(', ')})
          IS DISTINCT FROM (${compared.map((column) => `EXCLUDED.${column}`).join(', ')})
        RETURNING s.id
      ) ${PAGE_RESULT}`
  }
  const compared = ['knowledge_base_id', 'document_id', 'enabled', 'content', 'connector_id', 'acl']
  return `WITH ${PAGE}, source AS MATERIALIZED (
      SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled,
        knowledge_tin_base_token(e.knowledge_base_id) || ' ' || knowledge_tin_stream(e.content_tsv) AS content,
        d.connector_id, d.acl, k.is_search_index
      FROM page p JOIN embedding e ON e.id = p.id
      JOIN knowledge_base k ON k.id = e.knowledge_base_id
      JOIN document d ON d.id = e.document_id
    ), removed AS (
      DELETE FROM embedding_keyword_tin t USING source
      WHERE t.id = source.id AND NOT source.is_search_index
    ), written AS (
      INSERT INTO embedding_keyword_tin AS t (${['id', ...compared].join(', ')})
      SELECT id, ${compared.join(', ')} FROM source WHERE is_search_index
      ON CONFLICT (id) DO UPDATE SET
        ${compared.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}
      WHERE (${compared.map((column) => `t.${column}`).join(', ')})
        IS DISTINCT FROM (${compared.map((column) => `EXCLUDED.${column}`).join(', ')})
      RETURNING t.id
    ) ${PAGE_RESULT}`
}

/**
 * Copies the document's source and ACL onto a page's existing projection rows that differ,
 * including rows the source and ACL fill has not reached. Chunks are untouched, so their vectors
 * are never read; a row a chunk change has not projected yet is left to that change's own mark.
 */
function sourceAclPageStatement(projection: KnowledgeProjection): string {
  return `WITH ${PAGE}, written AS (
      UPDATE ${projection} s SET connector_id = d.connector_id, acl = d.acl
      FROM page p, document d
      WHERE s.id = p.id AND d.id = $1
        AND (s.connector_id IS DISTINCT FROM d.connector_id OR s.acl IS DISTINCT FROM d.acl)
      RETURNING s.id
    ) ${PAGE_RESULT}`
}

/**
 * The failures that give a document up for this pass rather than failing the run: the database
 * had no room for the page or it lost to a concurrent transaction, or (`23503`) a chunk was
 * deleted while its page was being written, whose document is then gone or re-marked by the
 * insert that replaced the chunk. A lost connection fails the run, which the task retries.
 */
function isDeferrable(error: unknown): boolean {
  if (getPostgresErrorCode(error) === '23503') return true
  const failure = getTransientDatabaseFailure(error)
  return failure === 'capacity' || failure === 'conflict'
}

/** The bounds and mode every projector transaction runs under. */
async function enterProjectorTransaction(tx: TransactionSql, lockTimeoutMs: number) {
  await tx.unsafe(
    `SELECT set_config('lock_timeout', '${lockTimeoutMs}ms', true),
      set_config('statement_timeout', '${PROJECTION_PAGE_STATEMENT_TIMEOUT_MS}ms', true),
      ${DEFER_KNOWLEDGE_PROJECTION}`
  )
}

interface ProjectionMark {
  generation: number
  content: boolean
  knowledgeBaseId: string
}

export interface KnowledgeProjectionOptions {
  /**
   * Stop starting pages once this much time has passed, leaving the marks of documents not yet
   * finished for the next pass; unbounded otherwise. The page in flight still runs to its own
   * statement timeout, so a caller leaves that much headroom after the budget.
   */
  budgetMs?: number
  pageSize?: number
  /** Called after each page commits, for tests that interleave writes with a run. */
  onPage?: (page: {
    documentId: string
    projection: KnowledgeProjection
    written: number
  }) => Promise<void> | void
}

export interface KnowledgeProjectionProgress {
  /** Documents whose projection rows were rewritten and whose mark was removed. */
  settled: number
  /** Documents left marked: re-marked during their pass, locked, or given up on a timeout. */
  deferred: number
  pages: number
  written: number
  /** Whether marks may remain that this run did not reach. */
  remaining: boolean
}

/** Whether the Tin keyword projection is maintained here: its functions exist only where installed. */
async function tinInstalled(sql: Sql): Promise<boolean> {
  const [row] = await sql<Array<{ installed: boolean }>>`
    SELECT to_regprocedure('knowledge_tin_stream(tsvector)') IS NOT NULL AS installed`
  return Boolean(row?.installed)
}

/**
 * The oldest marks, past the ones this run has already passed over. A read without row locks: a
 * pass owns a document through its advisory lock, and a row lock on the mark would either block
 * the writers re-marking it for the whole pass or, taken only for the read, make passes that start
 * together skip each other's whole batch and stop. Passes reading the same batch split it at the
 * advisory lock, each moving on from a document another holds.
 */
async function claimMarks(sql: Sql, skipped: readonly string[]): Promise<string[]> {
  const rows = await sql<Array<{ document_id: string }>>`
    SELECT document_id FROM knowledge_projection_dirty
    WHERE NOT (document_id = ANY(${skipped as string[]}::text[]))
    ORDER BY marked_at LIMIT ${CLAIM_BATCH_SIZE}`
  return rows.map((row) => row.document_id)
}

/**
 * The document's mark, read once its advisory lock is held: only the lock holder removes a mark,
 * so the generation read here can afterwards only grow, or vanish with the document.
 */
async function readMark(sql: Sql, documentId: string): Promise<ProjectionMark | null> {
  const [row] = await sql<
    Array<{ generation: string; content: boolean; knowledge_base_id: string }>
  >`
    SELECT m.generation, m.content, d.knowledge_base_id
    FROM knowledge_projection_dirty m JOIN document d ON d.id = m.document_id
    WHERE m.document_id = ${documentId}`
  return row
    ? {
        generation: Number(row.generation),
        content: row.content,
        knowledgeBaseId: row.knowledge_base_id,
      }
    : null
}

/**
 * Removes the mark if it still carries the generation the pass read. A writer that marked the
 * document again meanwhile bumped it, so its change survives for the next pass; a writer still
 * holding the row is marking it again, and the mark stays.
 */
async function settleMark(
  sql: Sql,
  documentId: string,
  generation: number
): Promise<DocumentOutcome> {
  try {
    return await sql.begin(async (tx) => {
      await enterProjectorTransaction(tx, SETTLE_LOCK_TIMEOUT_MS)
      const [row] = await tx<Array<{ removed: number; marked: boolean }>>`
        WITH removed AS (
          DELETE FROM knowledge_projection_dirty
          WHERE document_id = ${documentId} AND generation = ${generation}
          RETURNING 1
        )
        SELECT (SELECT count(*)::int FROM removed) AS removed,
          EXISTS (SELECT 1 FROM knowledge_projection_dirty WHERE document_id = ${documentId}) AS marked`
      if (row?.removed) return 'settled'
      return row?.marked ? 'deferred' : 'gone'
    })
  } catch (error) {
    if (getPostgresErrorCode(error) === '55P03') return 'deferred'
    throw error
  }
}

/** Whether the document is still marked, after a pass over it was given up. */
async function stillMarked(sql: Sql, documentId: string): Promise<boolean> {
  const [row] = await sql<Array<{ marked: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM knowledge_projection_dirty WHERE document_id = ${documentId}) AS marked`
  return Boolean(row?.marked)
}

/**
 * Rewrites one projection of a document in pages bounded by chunk rows, each its own transaction.
 * Stops before a page once `deadline` passes and reports the projection unfinished; the pages
 * already written stand, and the document's next pass finds them current.
 */
async function projectDocumentRows(
  sql: Sql,
  documentId: string,
  projection: KnowledgeProjection,
  mark: ProjectionMark,
  options: KnowledgeProjectionOptions,
  deadline: number
): Promise<{ pages: number; written: number; finished: boolean }> {
  const pageSize = options.pageSize ?? PROJECTION_ROW_BATCH_SIZE
  const statement = mark.content
    ? contentPageStatement(projection)
    : sourceAclPageStatement(projection)
  let after = -1
  let pages = 0
  let written = 0
  for (;;) {
    if (Date.now() >= deadline) return { pages, written, finished: false }
    const page = await sql.begin(async (tx) => {
      await enterProjectorTransaction(tx, PROJECTION_PAGE_LOCK_TIMEOUT_MS)
      /** Shares the base's Tin membership lock, as the embedding trigger does, so a flip of its marker waits. */
      if (projection === 'embedding_keyword_tin')
        await tx`SELECT pg_advisory_xact_lock_shared(knowledge_tin_membership_key(${mark.knowledgeBaseId}))`
      const [row] = await tx.unsafe<
        Array<{ scanned: number; written: number; last_chunk: number | null }>
      >(statement, [documentId, after, pageSize])
      return row
    })
    pages += 1
    written += page.written
    await options.onPage?.({ documentId, projection, written: page.written })
    if (page.last_chunk === null || page.scanned < pageSize) break
    after = page.last_chunk
  }
  return { pages, written, finished: true }
}

type DocumentOutcome = 'settled' | 'deferred' | 'gone'

/**
 * Projects one marked document under its advisory lock, then settles the mark it read. A document
 * the deadline cuts short keeps its mark for the next pass.
 */
async function projectMarkedDocument(
  sql: Sql,
  documentId: string,
  projections: readonly KnowledgeProjection[],
  options: KnowledgeProjectionOptions,
  totals: { pages: number; written: number },
  deadline: number
): Promise<DocumentOutcome> {
  const [lock] = await sql<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(hashtextextended('knowledge_projection:' || ${documentId}, 0)) AS acquired`
  if (!lock?.acquired) return 'deferred'
  try {
    const mark = await readMark(sql, documentId)
    if (!mark) return 'gone'
    for (const projection of projections) {
      if (!mark.content && !mirrorsSourceAcl(projection)) continue
      const done = await projectDocumentRows(sql, documentId, projection, mark, options, deadline)
      totals.pages += done.pages
      totals.written += done.written
      if (!done.finished) return 'deferred'
    }
    return await settleMark(sql, documentId, mark.generation)
  } catch (error) {
    if (!isDeferrable(error)) throw error
    if (!(await stillMarked(sql, documentId))) return 'gone'
    logger.warn('Projection of a document deferred', {
      documentId,
      code: getPostgresErrorCode(error),
    })
    return 'deferred'
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtextextended('knowledge_projection:' || ${documentId}, 0))`
  }
}

/**
 * Converges the search projections of every marked document, oldest mark first, until none is
 * left or the budget runs out. Runs on a connection of its own: each document is projected under
 * a session advisory lock, so concurrent runs never project the same document at once and a run
 * that dies releases its locks with its connection. A document keeps its mark, left to a later
 * run, when another run holds it, when a page waits too long on a lock or runs past its timeout,
 * when a chunk is deleted under it, when it was re-marked while it ran, or when the budget runs
 * out mid-document. Every other failure fails the run.
 */
export async function runKnowledgeProjection(
  sql: Sql,
  options: KnowledgeProjectionOptions = {}
): Promise<KnowledgeProjectionProgress> {
  const deadline =
    options.budgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.budgetMs
  const projections = (await tinInstalled(sql))
    ? KNOWLEDGE_PROJECTIONS
    : KNOWLEDGE_PROJECTIONS.filter((projection) => projection !== 'embedding_keyword_tin')
  const totals = { pages: 0, written: 0 }
  const skipped: string[] = []
  let settled = 0
  while (Date.now() < deadline) {
    const claimed = await claimMarks(sql, skipped)
    if (claimed.length === 0) {
      return { settled, deferred: skipped.length, ...totals, remaining: skipped.length > 0 }
    }
    for (const documentId of claimed) {
      if (Date.now() >= deadline) break
      const outcome = await projectMarkedDocument(
        sql,
        documentId,
        projections,
        options,
        totals,
        deadline
      )
      if (outcome === 'settled') settled += 1
      else if (outcome === 'deferred') skipped.push(documentId)
    }
  }
  return { settled, deferred: skipped.length, ...totals, remaining: true }
}

/** Unfilled rows the fill reads per round, from each projection's unfilled-rows index. */
const FILL_SCAN_ROWS = 2_000

/**
 * Marks at most this many documents may be outstanding before the fill adds more. Marks are
 * projected oldest first, so this bounds how much fill work a fresh write can wait behind, and
 * search, which decides a marked document's rows on the document, keeps doing so for few of them.
 */
export const FILL_MARK_CEILING = 100

/**
 * Marks the documents of projection rows the source and ACL fill has not reached, so the projector
 * fills them as it converges any other document. Rows are read off each projection's unfilled
 * index after `afterId`, and only while fewer than {@link FILL_MARK_CEILING} marks are outstanding;
 * a row whose document is gone is passed over. Documents are taken in the order of their first
 * row read, up to the room left under the ceiling, and the cursor moves only past rows of the
 * documents taken: when the room runs out, it stops before the first row of the first document
 * left out, so the next call starts there. A taken document is marked only once its row is locked
 * `FOR KEY SHARE`, so a deletion committing meanwhile can never fail the mark's foreign key; one
 * whose row a deletion or another writer holds is skipped rather than waited on, since that writer
 * removes or rewrites its rows itself, and the next pass reads whatever is still unfilled. Returns
 * how many documents were marked and the id to continue after, or `null` once every projection's
 * unfilled rows have been read.
 */
export async function markUnfilledProjectionDocuments(
  sql: Sql,
  cursor: { projection: number; afterId: string } = { projection: 0, afterId: '' }
): Promise<{ marked: number; cursor: { projection: number; afterId: string } | null }> {
  const [{ outstanding }] = await sql<Array<{ outstanding: number }>>`
    SELECT count(*)::int AS outstanding FROM knowledge_projection_dirty`
  if (outstanding >= FILL_MARK_CEILING) return { marked: 0, cursor }
  for (let index = cursor.projection; index < SOURCE_ACL_PROJECTIONS.length; index++) {
    const projection = SOURCE_ACL_PROJECTIONS[index]
    const afterId = index === cursor.projection ? cursor.afterId : ''
    const [row] = await sql.unsafe<Array<{ marked: number; last_id: string | null }>>(
      `WITH unfilled AS MATERIALIZED (
        SELECT id, document_id FROM ${projection} WHERE acl IS NULL AND id > $1
        ORDER BY id LIMIT ${FILL_SCAN_ROWS}
      ), documents AS MATERIALIZED (
        SELECT u.document_id, min(u.id) AS first_id FROM unfilled u
        WHERE EXISTS (SELECT 1 FROM document d WHERE d.id = u.document_id)
        GROUP BY u.document_id
      ), chosen AS MATERIALIZED (
        SELECT document_id, first_id FROM documents ORDER BY first_id LIMIT $2
      ), locked AS MATERIALIZED (
        SELECT d.id FROM document d WHERE d.id IN (SELECT document_id FROM chosen)
        FOR KEY SHARE SKIP LOCKED
      ), held AS (
        SELECT min(first_id) AS first_id FROM documents
        WHERE document_id NOT IN (SELECT document_id FROM chosen)
      ), marked AS (
        INSERT INTO knowledge_projection_dirty (document_id)
        SELECT id FROM locked ORDER BY id
        ON CONFLICT (document_id) DO NOTHING RETURNING document_id
      ) SELECT (SELECT count(*)::int FROM marked) AS marked,
        (SELECT max(u.id) FROM unfilled u, held
          WHERE held.first_id IS NULL OR u.id < held.first_id) AS last_id`,
      [afterId, FILL_MARK_CEILING - outstanding]
    )
    if (row?.last_id)
      return { marked: row.marked, cursor: { projection: index, afterId: row.last_id } }
  }
  return { marked: 0, cursor: null }
}
