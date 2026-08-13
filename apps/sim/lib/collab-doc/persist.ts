import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import * as Y from 'yjs'
import {
  ContentVersionConflictError,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
} from '@/lib/uploads/contexts/workspace'
import { collabDocStateSourceHash, hashMarkdown, saveCollabDocState } from './collab-state'
import { canonicalizeYDoc, yDocToFileMarkdown } from './converter'

const logger = createLogger('FileDocPersist')

/**
 * Outcome of a persist attempt:
 * - `persisted` — the live doc was projected to markdown and written; `version` is the new durable
 *   CONTENT version (`content_updated_at`, epoch ms) the relay records as what its live doc is synced to.
 * - `missing` — the file is gone (deleted); nothing to write.
 * - `conflict` — the file changed out-of-band since the relay's live doc last synced, so writing the
 *   projection would clobber that change (RFC 7232 `If-Match` failure). NOT written; the relay leaves the
 *   durable content authoritative and does not advance its synced version (a later flush reconciles once
 *   the chokepoint merge lands). No `version` is returned — the relay never reads one on this path.
 */
export type PersistFileDocResult =
  | { status: 'persisted'; version: number }
  | { status: 'missing' }
  | { status: 'conflict' }
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
  // The snapshot cached below seeds a later cold room directly, so it must describe the same document
  // the durable markdown does — otherwise a warm open renders structure the markdown cannot reproduce
  // and the doc reflows once it settles. `canonicalizeYDoc` converges this DETACHED copy onto its own
  // markdown projection, which is exactly that guarantee, and leaves the live room untouched.
  let cachedDocState = docState
  try {
    Y.applyUpdate(ydoc, docState)
    if (canonicalizeYDoc(ydoc)) cachedDocState = Y.encodeStateAsUpdate(ydoc)
    markdownBuffer = Buffer.from(yDocToFileMarkdown(ydoc), 'utf-8')
  } finally {
    ydoc.destroy()
  }

  // A persist that would write the bytes already on disk is skipped entirely. Binding an editor to a
  // seeded document emits a Yjs update of its own — y-tiptap normalizes node attributes on bind — so
  // simply OPENING a file schedules a save whose projection is byte-identical to the file. Writing it
  // is not free: `updateWorkspaceFileContent` uploads under a FRESH storage key, repoints the row, and
  // deletes the old object, so every reader still holding the previous key 404s. That is the stray
  // not-found a page sees on open, racing its own first content read.
  //
  // Length is the free reject — a real edit almost never lands on the same byte count — so the compare
  // read happens only when a no-op write is actually on the table. Unchanged content means there is
  // nothing to clobber, so this reports the file's CURRENT durable version rather than conflicting on a
  // stale `expectedVersion`: it resynchronizes the relay's If-Match token instead of stranding it.
  if (record.size === markdownBuffer.length) {
    const current = await fetchWorkspaceFileBuffer(record).catch(() => null)
    if (current?.equals(markdownBuffer)) {
      // Still refresh the cached snapshot: the markdown is unchanged (so its `sourceHash` tag stays
      // valid) but the doc state may have just been canonicalized, and a cold open should seed from
      // the repaired binary rather than the one that needed repairing.
      try {
        await saveCollabDocState(fileId, cachedDocState, hashMarkdown(markdownBuffer))
      } catch (error) {
        logger.warn(`Failed to cache collab doc state for file ${fileId}`, {
          error: getErrorMessage(error),
        })
      }
      return {
        status: 'persisted',
        version: (record.contentUpdatedAt ?? record.updatedAt).getTime(),
      }
    }
  }

  const write = async (ifMatch: number): Promise<PersistFileDocResult> => {
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
        expectedUpdatedAt: new Date(ifMatch),
        secretProvenancePolicy: { mode: 'preserve' },
      }
    )

    // Cache the Yjs binary (tagged with the exact markdown just written) so a later cold room open loads
    // it directly instead of re-converting. Best-effort — the markdown is the durable source of truth.
    try {
      await saveCollabDocState(fileId, cachedDocState, hashMarkdown(markdownBuffer))
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
  }

  try {
    return await write(expectedVersion)
  } catch (error) {
    if (!(error instanceof ContentVersionConflictError)) throw error
    return recoverFromVersionConflict(workspaceId, fileId, markdownBuffer, write)
  }
}

/**
 * A stale If-Match does not prove someone else wrote the file — so ask the CONTENT, not the clock.
 *
 * The relay's token is a remembered timestamp: it lives in the room (lost when the room is dropped) and
 * in a cluster key written best-effort, so a process that dies in the moments after a successful write
 * comes back holding a version older than the file's. Every later persist then fails the CAS, and
 * because a conflict deliberately neither writes nor advances the token, the room can never persist
 * again: the session's edits stay in the stream, the durable markdown freezes at the last write, and
 * every reload renders that stale markdown before the live document corrects it on screen.
 *
 * The guard exists to protect content the live document has never seen. The file's own bytes settle
 * that directly: if they hash to what this document last projected ({@link collabDocStateSourceHash},
 * written with every successful persist), then nothing out-of-band exists and the write is safe — retry
 * it once against the file's current version. If they hash to anything else, the change is real, the
 * conflict stands, and the durable content stays authoritative exactly as before.
 */
async function recoverFromVersionConflict(
  workspaceId: string,
  fileId: string,
  markdownBuffer: Buffer,
  write: (ifMatch: number) => Promise<PersistFileDocResult>
): Promise<PersistFileDocResult> {
  const conflict = (): PersistFileDocResult => {
    logger.warn(
      `Persist conflict for file ${fileId}; durable content changed out-of-band since sync`
    )
    return { status: 'conflict' }
  }
  try {
    const current = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!current) return { status: 'missing' }
    const durable = await fetchWorkspaceFileBuffer(current)
    if (hashMarkdown(durable) !== (await collabDocStateSourceHash(fileId))) return conflict()
    logger.info(
      `Persist token for file ${fileId} was stale, not the file; re-syncing and writing the projection`
    )
    return await write((current.contentUpdatedAt ?? current.updatedAt).getTime())
  } catch (error) {
    // Including a SECOND conflict: something wrote the file during the recovery, which is the very
    // change the guard exists for.
    if (error instanceof ContentVersionConflictError) return conflict()
    logger.warn(`Persist conflict recovery failed for file ${fileId}`, {
      error: getErrorMessage(error),
    })
    return conflict()
  }
}
