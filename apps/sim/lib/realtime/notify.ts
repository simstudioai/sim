import { createLogger } from '@sim/logger'
import { FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('RealtimeNotify')

/** Bound the wait on the realtime server so a slow/hung socket pod can't stall a file mutation. */
const NOTIFY_TIMEOUT_MS = 2000

/**
 * Bound the wait on the live-doc merge. This OUTER call wraps the relay's inner relay→app `/merge`
 * request (`FILE_DOC_TIMEOUTS.mergeRequestMs`), so it must stay comfortably ABOVE that — the shared
 * constant + its test enforce the ordering. It leaves the inner merge plus the two network hops.
 */
const APPLY_EDIT_TIMEOUT_MS = FILE_DOC_TIMEOUTS.applyEditMs

/**
 * Best-effort fan-out to the realtime server that a workspace's file tree changed,
 * so every browser currently viewing that workspace's files refetches. File
 * mutations happen over the HTTP API (not the socket); this is a lossy liveness
 * signal — a dropped notification only degrades to stale-until-refetch.
 *
 * Never throws. Callers `await` it (rather than fire-and-forget) so the fetch is
 * guaranteed to dispatch before a Node route handler returns — a floating promise
 * can be dropped after the response is sent. It is a normally-sub-millisecond
 * local call and is hard-bounded to {@link NOTIFY_TIMEOUT_MS}, so it adds that
 * latency only when the socket pod is unreachable.
 */
export async function notifyWorkspaceFilesChanged(workspaceId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workspace-files-changed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workspaceId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('workspace-files-changed notify failed', {
        workspaceId,
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('workspace-files-changed notify error', {
      workspaceId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Best-effort fan-out to the realtime server that a workspace's table list changed (a table was
 * created, renamed, moved, deleted, or restored), so every browser currently viewing that
 * workspace's tables refetches. The list-level counterpart to {@link notifyWorkspaceFilesChanged};
 * table mutations happen server-side (HTTP routes AND copilot), so this fires from the shared table
 * service, not a socket. Lossy — a dropped notification only degrades to stale-until-refetch.
 *
 * Never throws. Callers `await` it so the fetch is guaranteed to dispatch before the mutation
 * returns; hard-bounded to {@link NOTIFY_TIMEOUT_MS}, so it adds that latency only when the socket
 * pod is unreachable.
 */
export async function notifyWorkspaceTablesChanged(workspaceId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workspace-tables-changed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workspaceId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('workspace-tables-changed notify failed', {
        workspaceId,
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('workspace-tables-changed notify error', {
      workspaceId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Folder resource types whose list is kept live by a workspace invalidation room: a folder mutation
 * (create/rename/move/delete/restore) for one of these must fan out the same list-changed signal as a
 * direct resource mutation, because a new/renamed/removed folder changes what that resource's browser
 * shows. Extend this map as more resource lists adopt an invalidation room — `file` and
 * `knowledge_base` currently refetch through their own paths, and `workflow` has no such list room.
 */
const FOLDER_RESOURCE_NOTIFIERS: Partial<
  Record<FolderResourceType, (workspaceId: string) => Promise<void>>
> = {
  table: notifyWorkspaceTablesChanged,
}

/**
 * Fan out the workspace live-list signal for a folder mutation, dispatched on the folder's resource
 * type. A no-op for resource types without an invalidation room. Never throws (the underlying notify
 * is best-effort). Callers `await` it so the dispatch is guaranteed before the mutation returns.
 */
export async function notifyFolderResourceChanged(
  resourceType: FolderResourceType,
  workspaceId: string
): Promise<void> {
  await FOLDER_RESOURCE_NOTIFIERS[resourceType]?.(workspaceId)
}

/**
 * How a live-doc merge is positioned on the file's monotonic version line. Pass one key or the other,
 * never both; passing neither applies the merge without ordering it (legacy).
 */
export interface LiveFileDocMergeOrder {
  /** A durable write's `contentUpdatedAt` (epoch ms): applied only if newer than the version the doc
   *  already incorporates, AND recorded as the synced version. */
  version?: number
  /** A streaming snapshot's causal base — the durable `contentUpdatedAt` it was built from. The relay
   *  drops the snapshot if a NEWER durable version was recorded than this (a concurrent write landed), and
   *  never records it as a checkpoint. */
  baseVersion?: number
}

/**
 * Best-effort: ask the realtime relay to merge a copilot edit into a file's LIVE collaborative
 * document, so open editors see it stream in as a CRDT merge (Stage C) rather than the file changing
 * underneath them. No-op when no doc is (or was recently) live (the relay reports `applied: false`).
 * The file itself is written durably by the caller regardless — this only drives the live view.
 * Never throws.
 *
 * The former clobber gap — an open editor's autosave dropping this edit — is now closed: a
 * collaborative editor no longer client-autosaves (the relay persists the shared doc to markdown
 * server-side), and the relay applies this merge THROUGH the shared Redis stream, so it reaches the
 * live doc on whichever task holds it and can't go stale relative to this direct write.
 *
 * A durable caller awaits this (so the fetch dispatches before the route handler returns); the copilot
 * streaming caller fires and forgets it. Bounded to {@link APPLY_EDIT_TIMEOUT_MS}, so it adds latency
 * only when the socket pod is unreachable.
 *
 * `order` ({@link LiveFileDocMergeOrder}) positions this merge so a stale write never regresses the doc.
 * A durable `version` applies only if newer than the version the doc already incorporates, and is recorded
 * as the synced version (the persist If-Match guard). A streaming `baseVersion` is the durable version the
 * snapshot was built from: the relay drops the snapshot if a NEWER durable write has since landed — so a
 * concurrent human edit is never clobbered (nor later persisted over the file) — and never records it, so
 * the synced version stays pinned to the last durable write, which the copilot tool's final `edit_content`
 * write carries, reconciling the durable file.
 *
 * Ordering is enforced at two scales. Within this process, merges for a file run on a single serialized
 * chain — each chained after the current tail — so a durable write applies after any in-flight streaming
 * merge and after every earlier durable write, never concurrently. Across processes, the per-process
 * chain does not apply, so the relay orders merges by that monotonic version under a cluster-wide lock.
 * The copilot streaming caller uses {@link isLiveDocMergeInFlight} to skip redundant snapshots while one
 * is in flight, so a slow relay can't backlog stale snapshots.
 */
export async function mergeEditIntoLiveFileDoc(
  fileId: string,
  markdown: string,
  order: LiveFileDocMergeOrder = {}
): Promise<void> {
  const tail = liveDocMergeChain.get(fileId) ?? Promise.resolve()
  const run = tail.then(() => applyLiveFileDocMerge(fileId, markdown, order))
  liveDocMergeChain.set(fileId, run)
  try {
    await run
  } finally {
    if (liveDocMergeChain.get(fileId) === run) liveDocMergeChain.delete(fileId)
  }
}

/** Per file, the tail of the serialized merge chain (each merge applies after it); never rejects
 *  because {@link applyLiveFileDocMerge} never throws. Absent when the file's chain is idle. */
const liveDocMergeChain = new Map<string, Promise<void>>()

/**
 * Whether a live-doc merge is currently running or queued for the file. The copilot streaming caller
 * checks this to skip a redundant snapshot (and to not advance its send throttle) while a merge is in
 * flight — bounding the stream to one live merge per file at a time without backlogging stale
 * snapshots behind a slow relay.
 */
export function isLiveDocMergeInFlight(fileId: string): boolean {
  return liveDocMergeChain.has(fileId)
}

/** POST the merge to the relay. Never throws (a live-doc merge is best-effort). */
async function applyLiveFileDocMerge(
  fileId: string,
  markdown: string,
  order: LiveFileDocMergeOrder
): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/file-doc/apply-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      // `version` (durable `contentUpdatedAt`) records the synced version the live doc now incorporates
      // (the persist If-Match guard); `baseVersion` is a streaming snapshot's causal base, checked (drop
      // if a newer durable landed) but never recorded. JSON.stringify drops whichever is undefined.
      body: JSON.stringify({
        fileId,
        markdown,
        version: order.version,
        baseVersion: order.baseVersion,
      }),
      signal: AbortSignal.timeout(APPLY_EDIT_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('file-doc apply-edit failed', { fileId, status: response.status })
    }
  } catch (error) {
    logger.warn('file-doc apply-edit error', { fileId, error: getErrorMessage(error) })
  }
}
