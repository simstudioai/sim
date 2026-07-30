import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import * as Y from 'yjs'
import {
  ContentVersionConflictError,
  getWorkspaceFile,
  updateWorkspaceFileContent,
} from '@/lib/uploads/contexts/workspace'
import { hashMarkdown, saveCollabDocState } from './collab-state'
import { yDocToFileMarkdown } from './converter'

const logger = createLogger('FileDocPersist')

/**
 * Outcome of a persist attempt:
 * - `persisted` — the live doc was projected to markdown and written; `version` is the new durable
 *   CONTENT version (`content_updated_at`, epoch ms) the relay records as what its live doc is synced to.
 * - `missing` — the file is gone (deleted); nothing to write.
 * - `conflict` — the file changed out-of-band since the relay's live doc last synced, so writing the
 *   projection would clobber that change (RFC 7232 `If-Match` failure). NOT written. `version` is the
 *   current durable version the relay adopts as its new If-Match to re-persist the current live stream
 *   (which already holds the out-of-band change via the write chokepoint).
 */
export type PersistFileDocResult =
  | { status: 'persisted'; version: number }
  | { status: 'missing' }
  | { status: 'conflict'; version: number }
  | { status: 'deferred' }

/**
 * Project a live collaborative document back to durable markdown and write it to the file. The realtime
 * relay owns the live Yjs doc but not the conversion engine or blob/DB access, so it ships the doc state
 * here and the app persists it — the server-authoritative durable path that replaces the editor's
 * client-side autosave.
 *
 * `expectedVersion` (the durable CONTENT version, `content_updated_at` epoch ms, the relay's live doc last
 * synced from) is the optimistic-concurrency guard: the write commits only if the file is still at that
 * content version — a rename/move that only bumps `updatedAt` won't trip it, so a
 * projection built from a stale live doc can never silently overwrite an out-of-band edit. On a version
 * mismatch this returns `conflict` (the current durable version) instead of writing — the relay adopts
 * it as its new If-Match and retries against the current live stream. Omit `expectedVersion` to write
 * unconditionally (e.g. the first persist, before any synced version exists).
 *
 * `userId` is attribution only (blob metadata); the caller is already trusted via the `x-api-key` gate.
 */
export async function persistFileDoc(
  workspaceId: string,
  fileId: string,
  userId: string,
  docState: Uint8Array,
  expectedVersion?: number
): Promise<PersistFileDocResult> {
  const record = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!record) return { status: 'missing' }

  // Optimistic concurrency needs a version. If none was supplied — the relay's synced-version token was
  // momentarily unavailable (a Redis blip on a peer-seeded task) — DEFER rather than write: an
  // unconditional write could clobber an out-of-band edit, and a reconcile would wipe live edits even
  // when nothing changed out-of-band (the version was merely missing). The edits stay in the stream; a
  // later persist writes them once the version is re-established. There is deliberately NO empty-file
  // unconditional-write carve-out: every existing file has a `content_updated_at`, so the relay always
  // has a real version to send and a missing one is always transient — and `record.size` is read outside
  // the write transaction, so trusting it (an empty file "has nothing to clobber") is a TOCTOU race a
  // concurrent first content write would lose.
  if (expectedVersion === undefined) {
    return { status: 'deferred' }
  }

  const ydoc = new Y.Doc()
  let markdownBuffer: Buffer
  try {
    Y.applyUpdate(ydoc, docState)
    markdownBuffer = Buffer.from(yDocToFileMarkdown(ydoc), 'utf-8')
  } finally {
    ydoc.destroy()
  }

  try {
    const updated = await updateWorkspaceFileContent(
      workspaceId,
      fileId,
      userId,
      markdownBuffer,
      undefined,
      {
        // This write IS the projection of the live doc, so re-merging it into that same doc would loop.
        syncLiveDoc: false,
        // If-Match: only if the durable file is still at the version the live doc synced from.
        expectedUpdatedAt: expectedVersion !== undefined ? new Date(expectedVersion) : undefined,
      }
    )

    // Cache the Yjs binary (tagged with the exact markdown just written) so a later cold room open loads
    // it directly instead of re-converting. Best-effort — the markdown is the durable source of truth.
    try {
      await saveCollabDocState(fileId, docState, hashMarkdown(markdownBuffer))
    } catch (error) {
      logger.warn(`Failed to cache collab doc state for file ${fileId}`, {
        error: getErrorMessage(error),
      })
    }

    logger.info(
      `Persisted live collaborative document to file ${fileId} (workspace ${workspaceId})`
    )
    // Return the CONTENT version (what the CAS/seed/merge all guard on), not `updatedAt` — the relay
    // records this as its new If-Match token, so it must be the same field a later persist is checked
    // against. (A content write sets both to the same instant; using the wrong one only bites once they
    // diverge — e.g. a metadata write bumping `updatedAt` afterward.)
    return {
      status: 'persisted',
      version: (updated.contentUpdatedAt ?? updated.updatedAt).getTime(),
    }
  } catch (error) {
    if (!(error instanceof ContentVersionConflictError)) throw error
    // Out-of-band content change since the live doc last synced — DON'T clobber. Return the current
    // durable version so the relay adopts it as its new If-Match and re-persists the current live stream
    // (which already holds the out-of-band change, merged in via the write chokepoint). No markdown body
    // is returned: the relay never projects the durable body back over the live doc (that would be a
    // destructive "make it match" that could move the doc backward and wipe newer edits).
    const current = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!current) return { status: 'missing' }
    logger.warn(
      `Persist conflict for file ${fileId}; durable content changed out-of-band since sync`
    )
    return {
      status: 'conflict',
      // The CONTENT version, not `updatedAt`: the relay adopts this as its If-Match. If a metadata write
      // bumped `updatedAt` past `contentUpdatedAt`, returning `updatedAt` would make the re-persist's CAS
      // (which checks `contentUpdatedAt`) never match → perpetual conflict.
      version: (current.contentUpdatedAt ?? current.updatedAt).getTime(),
    }
  }
}
