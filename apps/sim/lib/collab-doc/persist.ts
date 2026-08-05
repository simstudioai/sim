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
import { stripEmptyTopLevelParagraphs } from './normalize'

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
  // The Yjs snapshot cached below (`saveCollabDocState`) seeds a later cold room open directly, so it
  // must never carry structure the markdown re-parse would strip — a top-level empty paragraph left in
  // the snapshot resurfaces as a stray blank line when that warm doc settles, diverging from the static
  // placeholder. Normalize it out here so the cached binary matches the durable markdown by construction.
  let cachedDocState = docState
  try {
    Y.applyUpdate(ydoc, docState)
    if (stripEmptyTopLevelParagraphs(ydoc)) cachedDocState = Y.encodeStateAsUpdate(ydoc)
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
  } catch (error) {
    if (!(error instanceof ContentVersionConflictError)) throw error
    // Out-of-band content change since the live doc last synced — DON'T clobber. The relay leaves the
    // durable content authoritative and does NOT re-persist or advance its synced version here (a later
    // flush reconciles once the chokepoint merge lands), so it reads nothing off this result beyond the
    // `conflict` status — no durable version re-read is needed.
    logger.warn(
      `Persist conflict for file ${fileId}; durable content changed out-of-band since sync`
    )
    return { status: 'conflict' }
  }
}
