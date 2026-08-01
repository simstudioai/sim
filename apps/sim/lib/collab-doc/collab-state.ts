import { createHash } from 'crypto'
import { db } from '@sim/db'
import { workspaceFileCollabState } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

/**
 * The cached-collab-state cache (`workspace_file_collab_state`) lets a cold room open load the file's
 * last-persisted Yjs binary directly instead of re-converting markdown → Yjs on every open — the
 * Hocuspocus load-document pattern. See {@link workspaceFileCollabState} for the full rationale.
 */

/** sha256 (hex) of a markdown buffer — the freshness tag matching a cached doc state to the live file. */
export function hashMarkdown(markdown: Buffer): string {
  return createHash('sha256').update(markdown).digest('hex')
}

/**
 * Load a file's cached Yjs binary IF it is still fresh — i.e. was derived from markdown whose hash
 * matches `sourceHash` (the current file's markdown). Returns the binary to apply directly, or `null`
 * when there is no cache or it is stale (the markdown changed externally since it was saved), in which
 * case the caller re-converts from markdown. Applying the stored binary — rather than rebuilding a Y.Doc
 * from markdown — is what preserves the CRDT's client ids and prevents duplicated content on reconnect.
 */
export async function loadFreshCollabDocState(
  fileId: string,
  sourceHash: string
): Promise<Uint8Array | null> {
  const [row] = await db
    .select({
      docState: workspaceFileCollabState.docState,
      sourceHash: workspaceFileCollabState.sourceHash,
    })
    .from(workspaceFileCollabState)
    .where(eq(workspaceFileCollabState.fileId, fileId))
    .limit(1)

  if (!row || row.sourceHash !== sourceHash) return null
  return new Uint8Array(row.docState)
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
