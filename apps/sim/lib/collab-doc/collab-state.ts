import { createHash } from 'crypto'
import { db } from '@sim/db'
import { workspaceFileCollabState } from '@sim/db/schema'
import { and, eq, lte, sql } from 'drizzle-orm'

/**
 * The cached-collab-state cache (`workspace_file_collab_state`) lets a cold room open load the file's
 * last-persisted Yjs binary directly instead of re-converting markdown → Yjs on every open — the
 * Hocuspocus load-document pattern. See {@link workspaceFileCollabState} for the full rationale.
 */

/** sha256 (hex) of a markdown buffer — the freshness tag matching a cached doc state to the live file. */
export function hashMarkdown(markdown: Buffer): string {
  return createHash('sha256').update(markdown).digest('hex')
}

/** A file's stored collaborative document, with the markdown it was last derived from. */
export interface CachedCollabDocState {
  docState: Uint8Array
  /** Hash of the markdown this binary projects to — `null`s out nothing; compare to decide freshness. */
  sourceHash: string
}

/**
 * Load a file's stored Yjs binary, fresh or not.
 *
 * FRESH (its `sourceHash` matches the file's current markdown) means it can seed a room verbatim.
 * STALE means the markdown moved on out-of-band, and the caller must bring it up to date — but it must
 * do so by UPDATING this document, never by building a second one: the stored binary carries the
 * document's identity, and a rebuilt document's items carry different client ids, so any client still
 * holding the old one would merge the two into duplicated content. Either way this row is the file's
 * collaborative document; there is only ever one.
 * An optional byte cap filters oversized rows in SQL before their binary is loaded.
 */
export async function loadCollabDocState(
  fileId: string,
  options?: { maxBytes: number }
): Promise<CachedCollabDocState | null> {
  const [row] = await db
    .select({
      docState: workspaceFileCollabState.docState,
      sourceHash: workspaceFileCollabState.sourceHash,
    })
    .from(workspaceFileCollabState)
    .where(
      and(
        eq(workspaceFileCollabState.fileId, fileId),
        options &&
          lte(sql<number>`octet_length(${workspaceFileCollabState.docState})`, options.maxBytes)
      )
    )
    .limit(1)

  if (!row) return null
  return { docState: new Uint8Array(row.docState), sourceHash: row.sourceHash }
}

/**
 * Persist a collaborative doc's Yjs binary as the file's cold-start state, tagged with the hash of the
 * markdown it was derived from. Upsert — one row per file. Called from the server-side persist right
 * after the markdown is written, so the cached binary and its `sourceHash` are always consistent with
 * the file that was just saved.
 */
export async function saveCollabDocState(
  fileId: string,
  docState: Uint8Array,
  sourceHash: string
): Promise<void> {
  const state = Buffer.from(docState)
  const updatedAt = new Date()
  await db
    .insert(workspaceFileCollabState)
    .values({ fileId, docState: state, sourceHash, updatedAt })
    .onConflictDoUpdate({
      target: workspaceFileCollabState.fileId,
      set: { docState: state, sourceHash, updatedAt },
    })
}
