import { createLogger } from '@sim/logger'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import * as Y from 'yjs'
import { hashMarkdown, loadCollabDocState, saveCollabDocState } from '@/lib/collab-doc/collab-state'
import { canonicalizeYDoc, yDocToFileMarkdown } from '@/lib/collab-doc/converter'
import {
  ContentVersionConflictError,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
} from '@/lib/uploads/contexts/workspace'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const logger = createLogger('FileDocPersist')

/** Matches the decoded size of the persist endpoint's 16 MiB base64 snapshot limit. */
const MAX_RECOVERY_STATE_BYTES = 12 * 1024 * 1024

/**
 * Outcome of a persist attempt:
 * - `persisted` — the live doc was projected to markdown and written; `version` is the new durable
 *   CONTENT version (`content_updated_at`, epoch ms) the relay records as what its live doc is synced to.
 * - `missing` — the file is gone (deleted); nothing to write.
 * - `conflict` — safe replacement of the current durable content could not be established.
 *   Nothing was written; no version is returned, so the relay retains its synced version.
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
 * mismatch, recovery requires proof that this snapshot contains the current persisted edits;
 * otherwise the durable file remains authoritative. A missing `expectedVersion` defers the write.
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
    // A byte-for-byte equality check: anything longer than what we are comparing against
    // cannot match, so the buffer we are about to compare is itself the ceiling.
    const current = await fetchWorkspaceFileBuffer(record, {
      maxBytes: markdownBuffer.length,
    }).catch(() => null)
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
    return recoverFromVersionConflict(workspaceId, fileId, cachedDocState, markdownBuffer, write)
  }
}

/**
 * Recover a stale token only when the cached state matches the durable bytes and contributes no
 * missing content to this snapshot. A newer concurrent save may have advanced both the file and its
 * cache, so a matching hash alone cannot authorize retrying an older projection. The final CAS still
 * protects against writes arriving after this proof.
 */
async function recoverFromVersionConflict(
  workspaceId: string,
  fileId: string,
  docState: Uint8Array,
  markdownBuffer: Buffer,
  write: (ifMatch: number) => Promise<PersistFileDocResult>
): Promise<PersistFileDocResult> {
  const conflict = (): PersistFileDocResult => {
    logger.warn(
      `Persist conflict for file ${fileId}; snapshot could not safely replace durable content`
    )
    return { status: 'conflict' }
  }
  try {
    const current = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!current) return { status: 'missing' }
    const durable = await fetchWorkspaceFileBuffer(current, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    const cached = await loadCollabDocState(fileId, { maxBytes: MAX_RECOVERY_STATE_BYTES })
    if (
      !cached ||
      hashMarkdown(durable) !== cached.sourceHash ||
      !includesPersistedContent(docState, cached.docState, markdownBuffer)
    ) {
      return conflict()
    }
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

/**
 * Applying the persisted state must leave the candidate's projection unchanged, including deletions
 * and marks (which a state-vector comparison alone cannot prove). Harmless canonicalization of
 * detached cache snapshots is allowed; this never mutates the live document or the saved candidate.
 */
function includesPersistedContent(
  docState: Uint8Array,
  persistedState: Uint8Array,
  markdown: Buffer
): boolean {
  const candidate = new Y.Doc()
  const persisted = new Y.Doc()
  try {
    Y.applyUpdate(candidate, docState)
    Y.applyUpdate(persisted, persistedState)
    const generation = (doc: Y.Doc) =>
      doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
    if (generation(candidate) !== generation(persisted)) return false
    Y.applyUpdate(candidate, persistedState)
    return Buffer.from(yDocToFileMarkdown(candidate), 'utf-8').equals(markdown)
  } finally {
    candidate.destroy()
    persisted.destroy()
  }
}
