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
 * POST one workspace list-changed signal (`/api/workspace-<x>-changed`) to the realtime server,
 * which fans it out to every socket in that workspace's live-list room so their browser refetches.
 * Lossy — a dropped notification only degrades to stale-until-refetch. Never throws. Callers
 * `await` it (rather than fire-and-forget) so the fetch is guaranteed to dispatch before a Node
 * route handler returns — a floating promise can be dropped after the response is sent. It is a
 * normally-sub-millisecond local call, hard-bounded to {@link NOTIFY_TIMEOUT_MS}, so it adds that
 * latency only when the socket pod is unreachable.
 */
async function postWorkspaceListChanged(endpoint: string, workspaceId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workspaceId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn(`${endpoint} notify failed`, {
        workspaceId,
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn(`${endpoint} notify error`, {
      workspaceId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Best-effort fan-out that a workspace's file tree changed, so every viewer of that workspace's
 * files refetches. See {@link postWorkspaceListChanged} for the shared lossy/never-throws contract.
 */
export function notifyWorkspaceFilesChanged(workspaceId: string): Promise<void> {
  return postWorkspaceListChanged('workspace-files-changed', workspaceId)
}

/**
 * Best-effort fan-out that a workspace's table list changed (a table was created, renamed, moved,
 * deleted, or restored), so every viewer of that workspace's tables refetches. Fires from the
 * shared table service, so it covers every surface (HTTP routes AND copilot). See
 * {@link postWorkspaceListChanged} for the shared lossy/never-throws contract.
 */
export function notifyWorkspaceTablesChanged(workspaceId: string): Promise<void> {
  return postWorkspaceListChanged('workspace-tables-changed', workspaceId)
}

/**
 * Best-effort fan-out that a workspace's workflow registry changed (a workflow was created,
 * renamed, moved, deleted, duplicated, imported, restored, or reordered, or a workflow folder
 * changed), so every viewer's sidebar workflow list refetches. The list-level counterpart to the
 * per-workflow editor notifications ({@link notifyWorkflowUpdated}): those only reach sockets with
 * that workflow's canvas open, while this reaches everyone in the workspace. Fires from the
 * workflow application use cases, so it covers every surface (UI, CLI, copilot, API). See
 * {@link postWorkspaceListChanged} for the shared lossy/never-throws contract.
 */
export function notifyWorkspaceWorkflowsChanged(workspaceId: string): Promise<void> {
  return postWorkspaceListChanged('workspace-workflows-changed', workspaceId)
}

/** Best-effort fan-out that invalidates open editors for one durably changed workflow. */
export async function notifyWorkflowUpdated(workflowId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workflow-updated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workflowId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('workflow-updated notify failed', { workflowId, status: response.status })
    }
  } catch (error) {
    logger.warn('workflow-updated notify error', {
      workflowId,
      error: getErrorMessage(error),
    })
  }
}

/** Best-effort fan-out that removes one durably archived workflow from open clients. */
export async function notifyWorkflowDeleted(workflowId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workflow-deleted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workflowId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('workflow-deleted notify failed', { workflowId, status: response.status })
    }
  } catch (error) {
    logger.warn('workflow-deleted notify error', {
      workflowId,
      error: getErrorMessage(error),
    })
  }
}

/** Best-effort fan-out that replaces an open editor after a deployment is loaded into draft. */
export async function notifyWorkflowReverted(workflowId: string, timestamp: number): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workflow-reverted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workflowId, timestamp }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('workflow-reverted notify failed', { workflowId, status: response.status })
    }
  } catch (error) {
    logger.warn('workflow-reverted notify error', {
      workflowId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Folder resource types whose list is kept live by a workspace invalidation room: a folder mutation
 * (create/rename/move/delete/restore) for one of these must fan out the same list-changed signal as a
 * direct resource mutation, because a new/renamed/removed folder changes what that resource's browser
 * shows. Extend this map as more resource lists adopt an invalidation room — `file` and
 * `knowledge_base` currently refetch through their own paths.
 */
const FOLDER_RESOURCE_NOTIFIERS: Partial<
  Record<FolderResourceType, (workspaceId: string) => Promise<void>>
> = {
  table: notifyWorkspaceTablesChanged,
  workflow: notifyWorkspaceWorkflowsChanged,
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
 * How a durable live-doc merge is positioned on the file's monotonic version line. Omit `version` to
 * apply the merge without ordering it (legacy).
 */
export interface LiveFileDocMergeOrder {
  /** A durable write's `contentUpdatedAt` (epoch ms): applied only if newer than the version the doc
   *  already incorporates, AND recorded as the synced version (the persist If-Match guard). */
  version?: number
}

export type LiveFileDocMergeStatus = 'applied' | 'no-live-room' | 'merge-unavailable' | 'stale'

interface LiveFileDocMergeResponse {
  applied: boolean
  status: LiveFileDocMergeStatus
}

/**
 * Applies one durable file version to the live collaboration document and surfaces delivery
 * failures to callers that own a retry policy, such as the transactional outbox.
 */
export async function applyEditToLiveFileDoc(
  fileId: string,
  markdown: string,
  order: LiveFileDocMergeOrder = {},
  signal?: AbortSignal
): Promise<LiveFileDocMergeResponse> {
  const timeoutSignal = AbortSignal.timeout(APPLY_EDIT_TIMEOUT_MS)
  const response = await fetch(`${getSocketServerUrl()}/api/file-doc/apply-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
    body: JSON.stringify({ fileId, markdown, version: order.version }),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Live document reconciliation failed with status ${response.status}`)
  }

  const result = (await response.json()) as unknown
  if (typeof result !== 'object' || result === null) {
    throw new Error('Live document reconciliation returned an invalid response')
  }
  const candidate = result as Partial<LiveFileDocMergeResponse>
  const validStatus =
    candidate.status === 'applied' ||
    candidate.status === 'no-live-room' ||
    candidate.status === 'merge-unavailable' ||
    candidate.status === 'stale'
  if (typeof candidate.applied !== 'boolean' || !validStatus) {
    throw new Error('Live document reconciliation returned an invalid response')
  }
  return { applied: candidate.applied, status: candidate.status as LiveFileDocMergeStatus }
}

/**
 * Invalidates one live document after a durable replacement that cannot be merged into the rich
 * editor. Unlike list notifications this is durability-sensitive and throws so the outbox retries.
 */
export async function invalidateLiveFileDoc(
  fileId: string,
  version: number,
  signal?: AbortSignal
): Promise<void> {
  const timeoutSignal = AbortSignal.timeout(APPLY_EDIT_TIMEOUT_MS)
  const response = await fetch(`${getSocketServerUrl()}/api/file-doc/invalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
    body: JSON.stringify({ fileId, version }),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  })
  await response.body?.cancel().catch(() => {})
  if (!response.ok) {
    throw new Error(`Live document invalidation failed with status ${response.status}`)
  }
}
