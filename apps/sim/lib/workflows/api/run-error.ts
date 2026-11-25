import type { V2ExecutionError } from '@/lib/api/contracts/v2/workflows'
import type { StructuredExecutionError } from '@/executor/utils/errors'

/**
 * The v2 wire shape of a run's failure, shared by the execute result and the run resource: the
 * classified error with the block a rerun of it starts from, when the run's reader found one.
 */
export function presentV2RunError(
  error: StructuredExecutionError | null,
  rerunFromBlockId: string | undefined
): V2ExecutionError | null {
  if (!error) return null
  return rerunFromBlockId ? { ...error, rerunFromBlockId } : error
}
