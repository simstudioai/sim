import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SkippedItem } from '@/lib/workflows/editing/types'

/**
 * An `atomic` edit batch that could not be applied whole.
 *
 * This lives apart from the use case that throws it so a route error policy can
 * narrow on it without importing the edit engine. `route-policies.ts` is reached
 * by every workflow route, and pulling `apply-workflow-operations` in from there
 * would drag the engine — and its diff and comparison dependencies — into each
 * one. {@link WorkflowImportError} is split out for the same reason.
 */
export class WorkflowOperationsNotAppliedError extends OrchestrationError {
  constructor(readonly skipped: SkippedItem[]) {
    super(
      'conflict',
      `${skipped.length} operation(s) could not be applied and atomic was requested; nothing was written`
    )
    this.name = 'WorkflowOperationsNotAppliedError'
  }
}
