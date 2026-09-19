import { db } from '@sim/db'
import {
  workspaceFileSearchBuild,
  workspaceFileSearchChunk,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  FILE_SEARCH_BUILD_LEASE_MS,
  FILE_SEARCH_CHUNK_BYTES,
  FILE_SEARCH_CLEANUP_BATCH_BUILDS,
  FILE_SEARCH_CLEANUP_BATCH_ROWS,
  FILE_SEARCH_CLEANUP_BUDGET_MS,
  FILE_SEARCH_CLEANUP_MAX_BATCHES,
  FILE_SEARCH_CLEANUP_MIN_BATCH_MS,
  FILE_SEARCH_INDEX_TRANSACTION_LIMITS,
} from '@/lib/workspace-files/search/constants'
import { exceedsFileSearchBatchBudget } from '@/lib/workspace-files/search/index-batches'
import { estimateTrigramKeys, type FileSearchChunk } from '@/lib/workspace-files/search/index-plan'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'

export interface FileSearchRevision {
  workspaceId: string
  fileId: string
  sourceContentUpdatedAt: Date
}

export interface FileSearchBuild extends FileSearchRevision {
  id: string
}

function revisionFilter(revision: FileSearchRevision) {
  return and(
    eq(workspaceFileSearchRevision.fileId, revision.fileId),
    eq(workspaceFileSearchRevision.workspaceId, revision.workspaceId),
    eq(workspaceFileSearchRevision.sourceContentUpdatedAt, revision.sourceContentUpdatedAt)
  )
}

async function lockCurrentFile(tx: DbTransaction, revision: FileSearchRevision): Promise<boolean> {
  const [file] = await tx
    .select({
      workspaceId: workspaceFiles.workspaceId,
      context: workspaceFiles.context,
      deletedAt: workspaceFiles.deletedAt,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.id, revision.fileId))
    .for('update')
    .limit(1)
  return Boolean(
    file &&
      file.workspaceId === revision.workspaceId &&
      file.context === 'workspace' &&
      file.deletedAt === null &&
      file.contentUpdatedAt.getTime() === revision.sourceContentUpdatedAt.getTime()
  )
}

/** Lock order is file, build, revision. Chunk batches need only the latter two locks. */
async function lockBuild(tx: DbTransaction, build: FileSearchBuild): Promise<boolean> {
  const [lease] = await tx
    .select({ live: sql<boolean>`${workspaceFileSearchBuild.expiresAt} > clock_timestamp()` })
    .from(workspaceFileSearchBuild)
    .where(eq(workspaceFileSearchBuild.id, build.id))
    .for('update')
    .limit(1)
  if (!lease?.live) return false
  const [state] = await tx
    .select({ fileId: workspaceFileSearchRevision.fileId })
    .from(workspaceFileSearchRevision)
    .where(
      and(
        revisionFilter(build),
        eq(workspaceFileSearchRevision.status, 'pending'),
        eq(workspaceFileSearchRevision.buildId, build.id)
      )
    )
    .for('update')
    .limit(1)
  return Boolean(state)
}

/** A new attempt replaces the build token, never another attempt's chunks. */
export async function beginFileSearchBuild(
  revision: FileSearchRevision,
  dispatchToken?: string
): Promise<FileSearchBuild | null> {
  return db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, FILE_SEARCH_INDEX_TRANSACTION_LIMITS)
    if (!(await lockCurrentFile(tx, revision))) return null
    const [observed] = await tx
      .select({
        buildId: workspaceFileSearchRevision.buildId,
        dispatchedAt: workspaceFileSearchRevision.dispatchedAt,
      })
      .from(workspaceFileSearchRevision)
      .where(and(revisionFilter(revision), eq(workspaceFileSearchRevision.status, 'pending')))
      .limit(1)
    if (!observed || (dispatchToken && observed.dispatchedAt?.toISOString() !== dispatchToken))
      return null
    if (observed?.buildId) {
      await tx
        .update(workspaceFileSearchBuild)
        .set({ expiresAt: sql`clock_timestamp()` })
        .where(eq(workspaceFileSearchBuild.id, observed.buildId))
    }
    const [state] = await tx
      .select()
      .from(workspaceFileSearchRevision)
      .where(revisionFilter(revision))
      .for('update')
      .limit(1)
    if (!state || state.status !== 'pending') return null
    if (dispatchToken && state.dispatchedAt?.toISOString() !== dispatchToken) return null
    const build = { ...revision, id: generateId() }
    const now = new Date()
    await tx.insert(workspaceFileSearchBuild).values({
      ...build,
      expiresAt: sql`clock_timestamp() + ${FILE_SEARCH_BUILD_LEASE_MS} * interval '1 millisecond'`,
    })
    await tx
      .update(workspaceFileSearchRevision)
      .set({
        buildId: build.id,
        failureReason: null,
        chunkCount: 0,
        indexedBytes: 0,
        lineCount: 0,
        dispatchedAt: state.dispatchedAt ?? now,
        updatedAt: now,
      })
      .where(revisionFilter(revision))
    return build
  })
}

/** Each batch is fenced and work-bounded; no file or parser work runs inside this transaction. */
export async function appendFileSearchChunks(
  build: FileSearchBuild,
  chunks: readonly FileSearchChunk[],
  signal: AbortSignal
): Promise<boolean> {
  signal.throwIfAborted()
  if (!chunks.length) return true
  if (
    chunks.some((chunk) => Buffer.byteLength(chunk.content) > FILE_SEARCH_CHUNK_BYTES) ||
    exceedsFileSearchBatchBudget(
      chunks.length,
      chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.content), 0),
      chunks.reduce((sum, chunk) => sum + estimateTrigramKeys(chunk.content), 0)
    )
  ) {
    throw new Error('File search insert batch exceeds its budget')
  }
  return db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, FILE_SEARCH_INDEX_TRANSACTION_LIMITS)
    if (!(await lockBuild(tx, build))) return false
    signal.throwIfAborted()
    await tx
      .insert(workspaceFileSearchChunk)
      .values(
        chunks.map((chunk) => ({ ...chunk, buildId: build.id, workspaceId: build.workspaceId }))
      )
    return true
  })
}

export type FileSearchPublication =
  | { status: 'ready'; lineCount: number; indexedBytes: number; chunkCount: number }
  | { status: 'skipped'; failureReason: string }

/** Publication changes one pointer only after every chunk is durable and the file is still current. */
export async function publishFileSearchBuild(
  build: FileSearchBuild,
  publication: FileSearchPublication,
  signal: AbortSignal
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, FILE_SEARCH_INDEX_TRANSACTION_LIMITS)
    signal.throwIfAborted()
    if (!(await lockCurrentFile(tx, build)) || !(await lockBuild(tx, build))) return false
    if (publication.status === 'ready') {
      const [stored] = await tx.execute<{ count: number; bytes: number }>(sql`
        SELECT count(*)::int AS count,
          coalesce(sum(octet_length(substring(content FROM overlap + 1))), 0)::int AS bytes
        FROM workspace_file_search_chunk WHERE build_id = ${build.id}`)
      /** Fragment delimiters are represented by line metadata, so stored bytes can be smaller. */
      if (stored.count !== publication.chunkCount || stored.bytes > publication.indexedBytes) {
        throw new Error('File search build is incomplete')
      }
    }
    await tx
      .update(workspaceFileSearchBuild)
      .set({ expiresAt: publication.status === 'ready' ? null : sql`clock_timestamp()` })
      .where(eq(workspaceFileSearchBuild.id, build.id))
    await tx
      .update(workspaceFileSearchRevision)
      .set({
        status: publication.status,
        buildId: publication.status === 'ready' ? build.id : null,
        failureReason: publication.status === 'skipped' ? publication.failureReason : null,
        lineCount: publication.status === 'ready' ? publication.lineCount : 0,
        indexedBytes: publication.status === 'ready' ? publication.indexedBytes : 0,
        chunkCount: publication.status === 'ready' ? publication.chunkCount : 0,
        updatedAt: new Date(),
      })
      .where(revisionFilter(build))
    return true
  })
}

/** Final failure callbacks cannot overwrite a later dispatch or a successful publication. */
export async function failFileSearchRevision(
  revision: FileSearchRevision,
  dispatchToken?: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, FILE_SEARCH_INDEX_TRANSACTION_LIMITS)
    if (!(await lockCurrentFile(tx, revision))) return
    const [state] = await tx
      .select()
      .from(workspaceFileSearchRevision)
      .where(revisionFilter(revision))
      .limit(1)
    if (
      !state ||
      state.status !== 'pending' ||
      (dispatchToken && state.dispatchedAt?.toISOString() !== dispatchToken)
    )
      return
    if (state.buildId)
      await tx
        .update(workspaceFileSearchBuild)
        .set({ expiresAt: sql`clock_timestamp()` })
        .where(eq(workspaceFileSearchBuild.id, state.buildId))
    await tx
      .update(workspaceFileSearchRevision)
      .set({
        status: 'failed',
        buildId: null,
        failureReason: 'indexing_error',
        updatedAt: new Date(),
      })
      .where(
        and(
          revisionFilter(revision),
          eq(workspaceFileSearchRevision.status, 'pending'),
          dispatchToken
            ? eq(workspaceFileSearchRevision.dispatchedAt, new Date(dispatchToken))
            : undefined
        )
      )
  })
}

/** Expired and invalidated builds drain without cascading a large delete through file mutations. */
export async function cleanupFileSearchBuilds(): Promise<number> {
  const deadline = Date.now() + FILE_SEARCH_CLEANUP_BUDGET_MS
  let deleted = 0
  for (let batch = 0; batch < FILE_SEARCH_CLEANUP_MAX_BATCHES; batch++) {
    if (deadline - Date.now() < FILE_SEARCH_CLEANUP_MIN_BATCH_MS) break
    const result = await db.transaction(async (tx) => {
      /** Re-read: acquiring the connection can itself have spent the rest of the budget. */
      const remainingBudget = deadline - Date.now()
      if (remainingBudget < FILE_SEARCH_CLEANUP_MIN_BATCH_MS) return null
      await configureFileSearchTransaction(tx, { statementTimeout: remainingBudget })
      const builds = await tx.execute<{
        id: string
      }>(sql`SELECT id FROM workspace_file_search_build
        WHERE expires_at <= now() ORDER BY expires_at, id LIMIT ${FILE_SEARCH_CLEANUP_BATCH_BUILDS} FOR UPDATE SKIP LOCKED`)
      if (!builds.length) return null
      const buildIds = sql.join(
        builds.map((build) => sql`${build.id}`),
        sql`, `
      )
      const [rows] = await tx.execute<{ count: number }>(sql`WITH batch AS (
        SELECT build_id, ordinal FROM workspace_file_search_chunk WHERE build_id IN (${buildIds})
        ORDER BY build_id, ordinal LIMIT ${FILE_SEARCH_CLEANUP_BATCH_ROWS}
      ), deleted AS (
        DELETE FROM workspace_file_search_chunk c USING batch
        WHERE c.build_id = batch.build_id AND c.ordinal = batch.ordinal RETURNING 1
      ) SELECT count(*)::int AS count FROM deleted`)
      await tx.execute(sql`DELETE FROM workspace_file_search_build build WHERE id IN (${buildIds})
        AND NOT EXISTS (SELECT 1 FROM workspace_file_search_chunk chunk WHERE chunk.build_id = build.id)`)
      return rows.count
    })
    if (result === null) break
    deleted += result
  }
  return deleted
}
