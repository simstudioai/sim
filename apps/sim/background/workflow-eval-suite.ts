import { task } from '@trigger.dev/sdk'
import {
  runWorkflowEvalSuiteJob,
  type WorkflowEvalSuiteJobPayload,
} from '@/lib/workflows/evals/run-service'
import { WORKFLOW_EVAL_SUITE_CONCURRENCY_LIMIT } from '@/background/concurrency-limits'

export const workflowEvalSuiteTask = task({
  id: 'workflow-eval-suite',
  machine: 'medium-1x',
  queue: { concurrencyLimit: WORKFLOW_EVAL_SUITE_CONCURRENCY_LIMIT },
  retry: { maxAttempts: 1 },
  run: async (payload: WorkflowEvalSuiteJobPayload) => {
    await runWorkflowEvalSuiteJob(payload)
  },
})
