import { task } from '@trigger.dev/sdk'
import {
  type KnowledgeImportPayload,
  runKnowledgeImport,
} from '@/lib/knowledge/transfer/import-runner'

/**
 * Trigger.dev wrapper around `runKnowledgeImport`. The import's lifecycle lives
 * in the `knowledge_base_import` state machine, so the task is a thin shell.
 *
 * `maxAttempts: 1` — a blind re-run would create a second knowledge base beside
 * the first attempt's. A crashed import is marked failed by the runner's own
 * catch, or by the stale-job janitor if the process died; the user re-imports.
 * `medium-1x` because a document's original file, up to 100 MB, is held in
 * memory while it is stored.
 */
export const knowledgeImportTask = task({
  id: 'knowledge-import',
  machine: 'medium-1x',
  retry: { maxAttempts: 1 },
  queue: {
    name: 'knowledge-import',
    concurrencyLimit: 10,
  },
  run: async (payload: KnowledgeImportPayload) => {
    await runKnowledgeImport(payload)
  },
})
