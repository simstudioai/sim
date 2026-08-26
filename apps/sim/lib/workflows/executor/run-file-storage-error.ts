import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'

/**
 * Classifies a storage failure raised while reading a file a run produced.
 *
 * A run's log row outlives its bytes: retention sweeps the objects on their own
 * schedule, so a run whose files are recorded can be read long after the objects
 * are gone. The provider reports that as `NoSuchKey`/`BlobNotFound`/`NotFound`,
 * which is an absent object rather than a server fault — propagating it verbatim
 * renders a `500` for a well-formed request, the defect class this surface
 * treats as most severe.
 *
 * Only absence is reclassified. A network failure, a permission denial, a
 * provider 5xx, and the size-limit errors the callers raise themselves all keep
 * propagating, because retrying is the right answer to some of those and none of
 * them mean the file is gone.
 */
export function classifyRunFileStorageError(error: unknown, message: string): unknown {
  if (error instanceof OrchestrationError) return error
  if (isObjectNotFoundError(error)) return new OrchestrationError('not_found', message)
  return error
}
