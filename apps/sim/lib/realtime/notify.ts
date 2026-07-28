import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('RealtimeNotify')

/** Bound the wait on the realtime server so a slow/hung socket pod can't stall a file mutation. */
const NOTIFY_TIMEOUT_MS = 2000

/**
 * Bound the wait on the live-doc merge. This OUTER call wraps the relay's inner relay→app `/merge`
 * request (`MERGE_REQUEST_TIMEOUT_MS`, 3s, in `apps/realtime/src/handlers/file-doc-app.ts`), so it
 * must stay comfortably ABOVE that — otherwise this aborts while the relay is still merging, and the
 * relay could apply the merge after we've returned, racing a follow-on edit. 6s leaves the inner 3s
 * plus the two network hops and the relay's own work.
 */
const APPLY_EDIT_TIMEOUT_MS = 6000

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
 * itself is written durably by the caller regardless — this only drives the live view — so a dropped
 * merge merely means editors see the change on their next reload. Never throws.
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
