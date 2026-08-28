import { findCause } from '@sim/utils/errors'
import { type BlockRetryConfig, resolveBlockRetryConfig } from '@sim/workflow-types/workflow'
import { isNonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import { isRetryEligibleBlock } from '@/lib/workflows/blocks/retry-eligibility'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import type { SerializedBlock } from '@/serializer/types'

/**
 * Returns the retry policy for a block, or `null` when it must not retry.
 *
 * Eligibility comes from the same gate the editor offers the control behind, so
 * a block can never keep retrying after an edit that hides its control.
 */
export function resolveBlockRetryPolicy(block: SerializedBlock): BlockRetryConfig | null {
  const eligible = isRetryEligibleBlock({
    blockType: block.metadata?.id,
    category: block.metadata?.category,
    triggerMode: block.config?.params?.triggerMode === true,
  })
  return eligible ? resolveBlockRetryConfig(block.retry) : null
}

const isAbortError = (value: unknown): value is Error =>
  value instanceof Error && value.name === 'AbortError'

/**
 * Whether a failure should be replayed.
 *
 * Deliberately indiscriminate: a builder who switches retry on wants the block
 * tried again, and there is no reliable way to tell a transient failure from a
 * permanent one. Only failures that are not really failures are excluded — a
 * deliberate stop, and a child workflow whose own blocks already ran their
 * policies.
 *
 * The cause chain is walked because providers rewrap failures and overwrite
 * `name`, leaving the original classification only on `cause`.
 */
export function isRetryableBlockError(error: unknown): boolean {
  if (isNonRetryableExecutionError(error)) return false
  if (findCause(error, ChildWorkflowError.isChildWorkflowError)) return false
  if (findCause(error, isAbortError)) return false
  return true
}
