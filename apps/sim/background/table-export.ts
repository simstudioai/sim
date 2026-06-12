import { task } from '@trigger.dev/sdk'
import { runTableExport, type TableExportPayload } from '@/lib/table/export-runner'

/**
 * Trigger.dev wrapper around `runTableExport`. Retry-safe: a retried attempt regenerates the file
 * from scratch (failures clean up their partial upload), and the `table_jobs` ownership gate
 * stops a run that lost the job. `medium-1x` — the serialized file is buffered in memory before
 * the single-shot storage upload (~hundreds of MB worst case for enterprise 1M-row tables).
 */
export const tableExportTask = task({
  id: 'table-export',
  machine: 'medium-1x',
  retry: { maxAttempts: 3 },
  queue: {
    name: 'table-export',
    concurrencyLimit: 10,
  },
  run: async (payload: TableExportPayload) => {
    await runTableExport(payload)
  },
})
