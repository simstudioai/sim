import { task } from '@trigger.dev/sdk'
import {
  markTableDeleteFailed,
  runTableDelete,
  type TableDeletePayload,
} from '@/lib/table/delete-runner'

/**
 * `TableDeletePayload` with the cutoff as an ISO string — task payloads cross a JSON boundary, so
 * the Date is rehydrated in `run` rather than trusting payload serialization.
 */
export interface TableDeleteTaskPayload extends Omit<TableDeletePayload, 'cutoff'> {
  cutoff: string
}

/**
 * Trigger.dev wrapper around `runTableDelete`. Errors propagate out of `run` so the retry policy
 * actually fires; the job is marked failed only in `onFailure`, after the final attempt. Retry-
 * safe: the worker keysets by id with a `created_at <= cutoff` floor and batches are committed
 * independently, so a retried attempt simply re-walks and deletes whatever remains. The
 * `table_jobs` ownership gate stops a retried run that lost the job (canceled / janitor-failed)
 * within one page.
 */
export const tableDeleteTask = task({
  id: 'table-delete',
  machine: 'small-1x',
  retry: { maxAttempts: 3 },
  queue: {
    name: 'table-delete',
    concurrencyLimit: 10,
  },
  run: async (payload: TableDeleteTaskPayload) => {
    await runTableDelete({ ...payload, cutoff: new Date(payload.cutoff) })
  },
  onFailure: async ({ payload, error }) => {
    await markTableDeleteFailed(payload.tableId, payload.jobId, error)
  },
})
