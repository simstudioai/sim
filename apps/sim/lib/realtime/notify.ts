import { createLogger } from '@sim/logger'
import { FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
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
 * Best-effort: ask the realtime relay to merge a copilot edit into a file's LIVE collaborative
 * document, so open editors see it stream in as a CRDT merge (Stage C) rather than the file changing
 * underneath them. No-op when no editor is connected (the relay reports `applied: false`). The file
 * itself is written durably by the caller regardless — this only drives the live view. Never throws.
 *
 * KNOWN GAP (narrow): if an editor IS open but this merge fails (socket pod slow/down), the open
 * editor keeps the pre-edit doc; the user's next keystroke autosaves that stale doc over the durable
 * write, dropping the copilot edit until a reload. This is the interim cost of "durable file write +
 * best-effort live merge + editor autosave reconciles" and is closed by the deferred move to a
 * durable server-authoritative doc (copilot writing THROUGH the document rather than the file). Rare
 * — it needs the socket pod unreachable exactly while the file is open — and non-corrupting.
 *
 * Awaited (not fire-and-forget) so the fetch dispatches before the route handler returns; bounded to
 * {@link APPLY_EDIT_TIMEOUT_MS}, so it adds latency only when the socket pod is unreachable.
 */
export async function mergeEditIntoLiveFileDoc(fileId: string, markdown: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/file-doc/apply-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ fileId, markdown }),
      signal: AbortSignal.timeout(APPLY_EDIT_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('file-doc apply-edit failed', { fileId, status: response.status })
    }
  } catch (error) {
    logger.warn('file-doc apply-edit error', { fileId, error: getErrorMessage(error) })
  }
}
