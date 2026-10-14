import { createHash } from 'crypto'
import { db } from '@sim/db'
import { workspaceFileCollabState, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'

/** Matches the decoded size of the persist endpoint's 16 MiB base64 snapshot limit. */
export const MAX_COLLAB_DOC_STATE_BYTES = 12 * 1024 * 1024

/** Reject oversized snapshots before copying, decoding, or writing them. */
export function assertCollabDocStateSize(docState: Uint8Array): void {
  if (docState.byteLength > MAX_COLLAB_DOC_STATE_BYTES) {
    throw new RangeError('Collaborative document state exceeds the 12 MiB limit')
  }
}

/** SHA-256 freshness tag for the exact durable markdown bytes. */
export function hashMarkdown(markdown: Buffer): string {
  return createHash('sha256').update(markdown).digest('hex')
}

/** Both the projected markdown and the complete binary history identify a cached revision. */
export interface CollabDocStateToken {
  sourceHash: string
  stateHash: string
}

/** The binary document is authoritative for CRDT identity, including deleted content history. */
export interface CachedCollabDocState extends CollabDocStateToken {
  docState: Uint8Array
}

/** A snapshot prepared against an exact cached revision, or an observed absent cache row. */
export interface PreparedCollabDocState {
  docState: Uint8Array
  sourceHash: string
  expectedState: CollabDocStateToken | null
}

/** A different writer has replaced the cached revision used to prepare this snapshot. */
export class CollabDocStateConflictError extends Error {
  constructor(fileId: string) {
    super(`Collaborative document state changed for file ${fileId}`)
    this.name = 'CollabDocStateConflictError'
  }
}

/**
 * Load the existing binary without mistaking an oversized state or a database failure for absence.
 * CASE bounds both the transferred binary and the hash work before either is materialized.
 */
export async function loadCollabDocState(
  fileId: string,
  options?: { maxBytes: number }
): Promise<CachedCollabDocState | null> {
  const maxBytes = Math.min(
    options?.maxBytes ?? MAX_COLLAB_DOC_STATE_BYTES,
    MAX_COLLAB_DOC_STATE_BYTES
  )
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Collaborative document state byte limit must be a non-negative integer')
  }
  const byteCount = sql<number>`octet_length(${workspaceFileCollabState.docState})`
  const [row] = await db
    .select({
      byteCount,
      docState: sql<Buffer | null>`CASE WHEN ${byteCount} <= ${maxBytes} THEN ${workspaceFileCollabState.docState} END`,
      sourceHash: workspaceFileCollabState.sourceHash,
      stateHash: sql<
        string | null
      >`CASE WHEN ${byteCount} <= ${maxBytes} THEN encode(sha256(${workspaceFileCollabState.docState}), 'hex') END`,
    })
    .from(workspaceFileCollabState)
    .where(eq(workspaceFileCollabState.fileId, fileId))
    .limit(1)

  if (!row) return null
  if (row.byteCount > maxBytes || row.docState === null || row.stateHash === null) {
    throw new RangeError(`Collaborative document state exceeds the ${maxBytes} byte limit`)
  }
  return {
    docState: new Uint8Array(row.docState),
    sourceHash: row.sourceHash,
    stateHash: row.stateHash,
  }
}

/**
 * Replace only the cached revision used to prepare this snapshot. The caller must already hold the
 * workspaceFiles row lock and validate its content version in this transaction.
 */
export async function saveCollabDocStateInTx(
  tx: DbTransaction,
  fileId: string,
  prepared: PreparedCollabDocState
): Promise<void> {
  assertCollabDocStateSize(prepared.docState)
  const expected = prepared.expectedState
  const matchesExpected = expected
    ? and(
        eq(workspaceFileCollabState.fileId, fileId),
        eq(workspaceFileCollabState.sourceHash, expected.sourceHash),
        eq(
          sql<
            string | null
          >`CASE WHEN octet_length(${workspaceFileCollabState.docState}) <= ${MAX_COLLAB_DOC_STATE_BYTES} THEN encode(sha256(${workspaceFileCollabState.docState}), 'hex') END`,
          expected.stateHash
        )
      )
    : undefined

  if (
    expected?.sourceHash === prepared.sourceHash &&
    expected.stateHash === createHash('sha256').update(prepared.docState).digest('hex')
  ) {
    const [current] = await tx
      .select({ fileId: workspaceFileCollabState.fileId })
      .from(workspaceFileCollabState)
      .where(matchesExpected)
      .limit(1)
    if (!current) throw new CollabDocStateConflictError(fileId)
    return
  }

  const values = {
    docState: Buffer.from(prepared.docState),
    sourceHash: prepared.sourceHash,
    updatedAt: new Date(),
  }
  const [accepted] = expected
    ? await tx
        .update(workspaceFileCollabState)
        .set(values)
        .where(matchesExpected)
        .returning({ fileId: workspaceFileCollabState.fileId })
    : await tx
        .insert(workspaceFileCollabState)
        .values({ fileId, ...values })
        .onConflictDoNothing({ target: workspaceFileCollabState.fileId })
        .returning({ fileId: workspaceFileCollabState.fileId })

  if (!accepted) throw new CollabDocStateConflictError(fileId)
}

export type CommitCollabDocStateResult =
  | { status: 'committed'; version: number }
  | { status: 'missing' }
  | { status: 'conflict' }

/** Commit a cache-only refresh against the locked file version and the exact cached revision. */
export async function commitCollabDocState(
  workspaceId: string,
  fileId: string,
  expectedVersion: number,
  prepared: PreparedCollabDocState
): Promise<CommitCollabDocStateResult> {
  assertCollabDocStateSize(prepared.docState)
  try {
    return await db.transaction(async (tx): Promise<CommitCollabDocStateResult> => {
      const [file] = await tx
        .select({ contentUpdatedAt: workspaceFiles.contentUpdatedAt })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.id, fileId),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .for('update')
        .limit(1)

      if (!file) return { status: 'missing' }
      const version = file.contentUpdatedAt.getTime()
      if (version !== expectedVersion) return { status: 'conflict' }

      await saveCollabDocStateInTx(tx, fileId, prepared)
      return { status: 'committed', version }
    })
  } catch (error) {
    if (error instanceof CollabDocStateConflictError) return { status: 'conflict' }
    throw error
  }
}
