import {
  BLOCK_RETRY_DEFAULT_WAIT_MS,
  BLOCK_RETRY_MAX_ATTEMPTS,
  BLOCK_RETRY_MAX_WAIT_MS,
  BLOCK_RETRY_MIN_ATTEMPTS,
  BLOCK_RETRY_MIN_WAIT_MS,
} from '@sim/workflow-types/workflow'
import { BlockType } from '@/executor/constants'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import type { SerializedBlock } from '@/serializer/types'

/** A validated policy; only produced for blocks that are eligible to retry. */
export interface ResolvedBlockRetryPolicy {
  maxAttempts: number
  waitMs: number
}

/**
 * Block types whose failure is not a transport event and must never be replayed.
 *
 * A human-in-the-loop block signals a pause by throwing; retrying would re-arm the
 * pause instead of resuming it. Loop and parallel sentinels carry iteration
 * bookkeeping, so replaying one would re-enter the surrounding construct.
 */
const NON_RETRYABLE_BLOCK_TYPES = new Set<string>([
  BlockType.HUMAN_IN_THE_LOOP,
  BlockType.SENTINEL_START,
  BlockType.SENTINEL_END,
])

/**
 * HTTP statuses that describe a transient server-side condition. A 4xx other than
 * 408/429 means the request itself was rejected and will be rejected identically
 * on replay, so it is deliberately absent.
 */
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504])

/** Node/Bun socket-level failure codes, none of which reach an application handler. */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
])

/**
 * Bun reports a dropped connection with a bare message and no `code`, so this
 * string is the only available signal. Kept as a single explicit needle rather
 * than a general message scan, which would sweep in application errors that merely
 * mention a socket.
 */
const BUN_SOCKET_CLOSED_MESSAGE = 'socket connection was closed unexpectedly'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Returns the retry policy for a block, or `null` when it must not retry.
 *
 * Ineligibility is decided here rather than at the call site so that a block type
 * added to {@link NON_RETRYABLE_BLOCK_TYPES} is excluded everywhere at once.
 */
export function resolveBlockRetryPolicy(block: SerializedBlock): ResolvedBlockRetryPolicy | null {
  const configured = block.retry
  if (!configured) return null

  const blockType = block.metadata?.id
  if (blockType && NON_RETRYABLE_BLOCK_TYPES.has(blockType)) return null

  const maxAttempts = clamp(
    Math.floor(configured.maxAttempts),
    BLOCK_RETRY_MIN_ATTEMPTS,
    BLOCK_RETRY_MAX_ATTEMPTS
  )
  if (!Number.isFinite(maxAttempts) || maxAttempts < BLOCK_RETRY_MIN_ATTEMPTS) return null

  const requestedWait = configured.waitMs ?? BLOCK_RETRY_DEFAULT_WAIT_MS
  const waitMs = Number.isFinite(requestedWait)
    ? clamp(requestedWait, BLOCK_RETRY_MIN_WAIT_MS, BLOCK_RETRY_MAX_WAIT_MS)
    : BLOCK_RETRY_DEFAULT_WAIT_MS

  return { maxAttempts, waitMs }
}

/**
 * Whether a failure is transient enough to be worth replaying.
 *
 * The cause chain is walked because providers rewrap transport failures — a
 * `ProviderError` overwrites `name`, so the original classification survives only
 * on `cause`. Bounded so a self-referential cause cannot loop.
 */
export function isRetryableBlockError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') break

    /**
     * A child workflow that failed already ran its own blocks, each with its own
     * retry policy. Replaying the parent would re-run all of them.
     */
    if (ChildWorkflowError.isChildWorkflowError(current)) return false

    const candidate = current as { name?: string; code?: string; status?: number; message?: string }

    /**
     * An abort is a deliberate stop — a user pressing Stop, or a block timeout
     * that has already spent its budget. Replaying either works against the
     * caller's intent, so aborts terminate the loop rather than extend it.
     */
    if (candidate.name === 'AbortError') return false

    if (candidate.name === 'TimeoutError') return true
    if (candidate.code && RETRYABLE_ERROR_CODES.has(candidate.code)) return true
    if (typeof candidate.status === 'number' && RETRYABLE_HTTP_STATUSES.has(candidate.status)) {
      return true
    }
    if (candidate.message?.includes(BUN_SOCKET_CLOSED_MESSAGE)) return true

    current = (current as { cause?: unknown }).cause
  }

  return false
}
