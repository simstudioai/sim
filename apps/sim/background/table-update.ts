import { task } from '@trigger.dev/sdk'
import {
  markTableUpdateFailed,
  runTableUpdate,
  type TableUpdatePayload,
} from '@/lib/table/update-runner'

/**
 * `TableUpdatePayload` with the cutoff as an ISO string — task payloads cross a JSON boundary, so
 * the Date is rehydrated in `run` rather than trusting payload serialization.
 */
export interface TableUpdateTaskPayload extends Omit<TableUpdatePayload, 'cutoff'> {
  cutoff: string
}

/**
 * Trigger.dev wrapper around `runTableUpdate`. Errors propagate out of `run` so the retry policy
 * fires; the job is marked failed only in `onFailure`, after the final attempt. Retry-safe: the
 * worker keysets by id with a `created_at <= cutoff` floor and the JSONB-merge patch is idempotent
 * (re-applying the same patch to an already-patched row is a no-op), so a retried attempt re-walks
 * and re-applies whatever remains. The `table_jobs` ownership gate stops a retried run that lost
 * the job within one page.
 */
export const tableUpdateTask = task({
  id: 'table-update',
  machine: 'small-1x',
  retry: { maxAttempts: 3 },
  queue: {
    name: 'table-update',
    concurrencyLimit: 10,
  },
  run: async (payload: TableUpdateTaskPayload) => {
    await runTableUpdate({ ...payload, cutoff: new Date(payload.cutoff) })
  },
  onFailure: async ({ payload, error }) => {
    await markTableUpdateFailed(payload.tableId, payload.jobId, error)
  },
})
