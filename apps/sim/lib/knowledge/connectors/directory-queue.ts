import { isRecordLike } from '@sim/utils/object'
import { getJobQueue } from '@/lib/core/async-jobs'
import { EXTERNAL_GROUP_SYNC_INTERVAL_MS } from '@/lib/knowledge/access/external-groups'
import { refreshConnectorDirectory } from '@/lib/knowledge/connectors/external-group-sync'

export const DIRECTORY_SYNC_TASK_ID = 'knowledge-connector-directory-sync'
export const DIRECTORY_SYNC_CONCURRENCY = 2
export const DIRECTORY_SYNC_MAX_DURATION_SECONDS = 30 * 60

/** Which sync interval an instant falls in; every tick and retry within it shares the value. */
function syncIntervalIndex(at: Date): number {
  return Math.floor(at.getTime() / EXTERNAL_GROUP_SYNC_INTERVAL_MS)
}

export interface DirectorySyncPayload {
  connectorId: string
  requestId: string
}

export function assertDirectorySyncPayload(value: unknown): DirectorySyncPayload {
  if (!isRecordLike(value)) throw new Error('Directory sync payload must be an object')
  const { connectorId, requestId } = value
  if (typeof connectorId !== 'string' || connectorId.length === 0) {
    throw new Error('Directory sync payload requires a connector ID')
  }
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Directory sync payload requires a request ID')
  }
  return { connectorId, requestId }
}

/** Dispatches through the shared queue so local runs share the worker's concurrency cap. */
export async function dispatchDirectorySync(
  connectorId: string,
  options: { requestId: string; tickAt: Date }
): Promise<void> {
  const payload: DirectorySyncPayload = { connectorId, requestId: options.requestId }
  const queue = await getJobQueue()
  await queue.enqueue(DIRECTORY_SYNC_TASK_ID, payload, {
    jobId: `${DIRECTORY_SYNC_TASK_ID}:${connectorId}:${syncIntervalIndex(options.tickAt)}`,
    tags: [`connector:${connectorId}`],
    concurrencyKey: DIRECTORY_SYNC_TASK_ID,
    concurrencyLimit: DIRECTORY_SYNC_CONCURRENCY,
    maxDurationSeconds: DIRECTORY_SYNC_MAX_DURATION_SECONDS,
    runner: async (value) => {
      const job = assertDirectorySyncPayload(value)
      return refreshConnectorDirectory(job.connectorId, job.requestId)
    },
  })
}
