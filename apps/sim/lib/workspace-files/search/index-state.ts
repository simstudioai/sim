import { db } from '@sim/db'
import {
  fileSearchDependency,
  workspaceFileSearchBuild,
  workspaceFileSearchChunk,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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
  FILE_SEARCH_MAX_DEPENDENCIES,
} from '@/lib/workspace-files/search/constants'
import { exceedsFileSearchBatchBudget } from '@/lib/workspace-files/search/index-batches'
import { estimateTrigramKeys, type FileSearchChunk } from '@/lib/workspace-files/search/index-plan'
import { lockFileSearchOwners } from '@/lib/workspace-files/search/owner-policy'
import {
  type FileSearchOwnerScope,
  fileSearchOwnerCondition,
  fileSearchOwnerFields,
  resolveFileSearchOwner,
  searchableFileCondition,
} from '@/lib/workspace-files/search/scope'
import type { FileSearchDependencyIdentity } from '@/lib/workspace-files/search/source'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'

export type FileSearchRevision = FileSearchOwnerScope & {
  fileId: string
  sourceContentUpdatedAt: Date
}

export type FileSearchBuild = FileSearchRevision & { id: string }

function revisionFilter(revision: FileSearchRevision) {
  return and(
    eq(workspaceFileSearchRevision.fileId, revision.fileId),
    fileSearchOwnerCondition(workspaceFileSearchRevision, resolveFileSearchOwner(revision)),
    eq(workspaceFileSearchRevision.sourceContentUpdatedAt, revision.sourceContentUpdatedAt)
  )
}

export async function lockFileSearchInputs(
  tx: DbTransaction,
  revision: FileSearchRevision,
  dependencies: readonly FileSearchDependencyIdentity[] = [],
  sourceKey?: string
): Promise<boolean> {
  const owner = resolveFileSearchOwner(revision)
  if (
    dependencies.length > FILE_SEARCH_MAX_DEPENDENCIES ||
    new Set(dependencies.map((entry) => entry.fileId)).size !== dependencies.length
  )
    throw new Error('Invalid file search dependency manifest')
  await lockFileSearchOwners(tx, [owner])
  const files = await tx
    .select({
      id: workspaceFiles.id,
      key: workspaceFiles.key,
      deletedAt: workspaceFiles.deletedAt,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(
      and(
        searchableFileCondition(owner),
        inArray(workspaceFiles.id, [
          ...new Set([revision.fileId, ...dependencies.map((entry) => entry.fileId)]),
        ])
      )
    )
    .orderBy(asc(workspaceFiles.id))
    .for('update')
  const byId = new Map(files.map((file) => [file.id, file]))
  const file = byId.get(revision.fileId)
  return Boolean(
    file &&
      file.deletedAt === null &&
      (sourceKey === undefined || file.key === sourceKey) &&
      file.contentUpdatedAt.getTime() === revision.sourceContentUpdatedAt.getTime() &&
      dependencies.every((entry) => {
        const current = byId.get(entry.fileId)
        return (
          current &&
          current.deletedAt === null &&
          current.key === entry.key &&
          current.contentUpdatedAt.getTime() === entry.sourceContentUpdatedAt.getTime()
        )
      })
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

/**
 * A new attempt replaces the build token, never another attempt's chunks. Beginning also completes
 * the claim's handoff: the run the claim was waiting for evidently exists, even if the dispatcher
 * never recorded enqueueing it.
 */
export async function beginFileSearchBuild(
  revision: FileSearchRevision,
  dispatchToken?: string
): Promise<FileSearchBuild | null> {
  return db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, FILE_SEARCH_INDEX_TRANSACTION_LIMITS)
    if (!(await lockFileSearchInputs(tx, revision))) return null
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
      id: build.id,
      fileId: build.fileId,
      sourceContentUpdatedAt: build.sourceContentUpdatedAt,
      ...fileSearchOwnerFields(resolveFileSearchOwner(build)),
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
        handoffExpiresAt: null,
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
    await tx.insert(workspaceFileSearchChunk).values(
      chunks.map((chunk) => ({
        ...chunk,
        buildId: build.id,
        ...fileSearchOwnerFields(resolveFileSearchOwner(build)),
      }))
    )
    return true
  })
}

export type FileSearchPublication =
  | {
      status: 'ready'
      lineCount: number
      indexedBytes: number
      chunkCount: number
      dependencies?: readonly FileSearchDependencyIdentity[]
      artifactKey?: string
    }
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
    if (
      !(await lockFileSearchInputs(
        tx,
        build,
        publication.status === 'ready' ? publication.dependencies : []
      )) ||
      !(await lockBuild(tx, build))
    )
      return false
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
    if (publication.status === 'ready' && publication.dependencies?.length) {
      await tx
        .insert(fileSearchDependency)
        .values(
          publication.dependencies.map((dependency) => ({ ...dependency, buildId: build.id }))
        )
    }
    await tx
      .update(workspaceFileSearchBuild)
      .set({
        expiresAt: publication.status === 'ready' ? null : sql`clock_timestamp()`,
        artifactKey: publication.status === 'ready' ? (publication.artifactKey ?? null) : null,
      })
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
    if (!(await lockFileSearchInputs(tx, revision))) return
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
