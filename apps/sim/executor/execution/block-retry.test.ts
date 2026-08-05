/**
 * @vitest-environment node
 *
 * Retry is opt-in because the platform cannot know whether a block's operation is
 * idempotent. These pin the eligibility rules and the transient/permanent split.
 */
import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import { isRetryableBlockError, resolveBlockRetryPolicy } from '@/executor/execution/block-retry'
import type { SerializedBlock } from '@/serializer/types'

function block(overrides: Partial<SerializedBlock> = {}): SerializedBlock {
  return {
    id: 'b1',
    position: { x: 0, y: 0 },
    config: { tool: 'slack_send', params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
    metadata: { id: 'slack' },
    ...overrides,
  } as SerializedBlock
}

function err(props: Record<string, unknown>): Error {
  return Object.assign(new Error((props.message as string) ?? 'boom'), props)
}

describe('resolveBlockRetryPolicy', () => {
  it('returns null when the builder has not opted in', () => {
    expect(resolveBlockRetryPolicy(block())).toBeNull()
  })

  it('returns a policy when configured', () => {
    expect(resolveBlockRetryPolicy(block({ retry: { maxAttempts: 3, waitMs: 500 } }))).toEqual({
      maxAttempts: 3,
      waitMs: 500,
    })
  })

  it('defaults the wait when only attempts are given', () => {
    expect(resolveBlockRetryPolicy(block({ retry: { maxAttempts: 2 } }))?.waitMs).toBe(1000)
  })

  it('clamps attempts and wait to their bounds', () => {
    expect(
      resolveBlockRetryPolicy(block({ retry: { maxAttempts: 99, waitMs: 10_000_000 } }))
    ).toEqual({ maxAttempts: 5, waitMs: 30_000 })
  })

  /**
   * A pause is signalled by throwing. Replaying it would re-arm the pause rather
   * than resume it, so the block type is refused even when retry is configured.
   */
  it('refuses a human-in-the-loop block even when configured', () => {
    expect(
      resolveBlockRetryPolicy(
        block({ metadata: { id: BlockType.HUMAN_IN_THE_LOOP }, retry: { maxAttempts: 3 } })
      )
    ).toBeNull()
  })

  it('refuses loop and parallel sentinels', () => {
    for (const id of [BlockType.SENTINEL_START, BlockType.SENTINEL_END]) {
      expect(
        resolveBlockRetryPolicy(block({ metadata: { id }, retry: { maxAttempts: 3 } }))
      ).toBeNull()
    }
  })
})

describe('isRetryableBlockError', () => {
  it('retries a transport deadline', () => {
    expect(isRetryableBlockError(new DOMException('timed out', 'TimeoutError'))).toBe(true)
  })

  it('retries socket-level codes', () => {
    expect(isRetryableBlockError(err({ code: 'ECONNRESET' }))).toBe(true)
    expect(isRetryableBlockError(err({ code: 'EAI_AGAIN' }))).toBe(true)
  })

  it("retries Bun's bare dropped-connection message", () => {
    expect(
      isRetryableBlockError(
        err({ message: 'The socket connection was closed unexpectedly. For more information...' })
      )
    ).toBe(true)
  })

  it('retries transient HTTP statuses only', () => {
    for (const status of [408, 429, 502, 503, 504]) {
      expect(isRetryableBlockError(err({ status }))).toBe(true)
    }
    for (const status of [400, 401, 403, 404, 422, 500]) {
      expect(isRetryableBlockError(err({ status }))).toBe(false)
    }
  })

  /**
   * The classification has to survive rewrapping: a provider replaces `name` when
   * it wraps a transport failure, so only `cause` still carries it.
   */
  it('finds a transport failure through the cause chain', () => {
    const wrapped = Object.assign(
      new Error('Provider request failed', {
        cause: new DOMException('timed out', 'TimeoutError'),
      }),
      { name: 'ProviderError' }
    )
    expect(isRetryableBlockError(wrapped)).toBe(true)
  })

  /**
   * The load-bearing abort case: a block timeout aborts the in-flight fetch, so the
   * abort carries a retryable transport failure underneath it. Without the guard the
   * walk would reach that cause and replay a request whose budget is already spent.
   * A bare AbortError proves nothing here — it is unretryable by default.
   */
  it('never retries an abort that wraps a retryable transport failure', () => {
    const abort = Object.assign(new DOMException('aborted', 'AbortError'), {
      cause: new DOMException('timed out', 'TimeoutError'),
    })
    expect(isRetryableBlockError(abort)).toBe(false)

    const abortWithStatus = Object.assign(new DOMException('aborted', 'AbortError'), {
      status: 503,
    })
    expect(isRetryableBlockError(abortWithStatus)).toBe(false)
  })

  it('never retries a failed child workflow', () => {
    const childError = Object.create(ChildWorkflowError.prototype)
    Object.assign(childError, { message: 'child failed', childTraceSpans: [] })
    expect(isRetryableBlockError(childError)).toBe(false)
  })

  it('does not retry an ordinary application error', () => {
    expect(isRetryableBlockError(new Error('Invalid channel id'))).toBe(false)
  })

  /** A self-referential cause must not hang the walk. */
  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    Object.defineProperty(a, 'cause', { value: b })
    expect(isRetryableBlockError(a)).toBe(false)
  })
})
