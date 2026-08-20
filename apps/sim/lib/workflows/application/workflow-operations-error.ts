import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SkippedItem, ValidationError } from '@/lib/workflows/editing/types'

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
  constructor(
    readonly skipped: SkippedItem[],
    /**
     * Block inputs the batch would have dropped rather than persisted — an
     * invalid credential or a platform-managed API key. Refusals in their own
     * right under `atomic`, and reported separately because no operation was
     * declined: the operation would have applied, minus a field.
     */
    readonly droppedInputs: ValidationError[] = []
  ) {
    super(
      'conflict',
      `${skipped.length} operation(s) could not be applied and ${droppedInputs.length} input(s) would have been dropped; atomic was requested, so nothing was written`
    )
    this.name = 'WorkflowOperationsNotAppliedError'
  }
}
