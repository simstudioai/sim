import {
  BLOCK_RETRY_DEFAULT_TRIES,
  BLOCK_RETRY_DEFAULT_WAIT_MS,
  BLOCK_RETRY_MAX_TRIES,
  BLOCK_RETRY_MAX_WAIT_MS,
  BLOCK_RETRY_MIN_TRIES,
  resolveBlockRetryConfig,
} from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import { isRetryableBlockError, resolveBlockRetryPolicy } from '@/executor/execution/block-retry'
import type { SerializedBlock } from '@/serializer/types'

function block(
  blockType: string,
  retry?: Partial<SerializedBlock['retry']>,
  params: Record<string, unknown> = {},
  category?: string
): SerializedBlock {
  return {
    id: 'block-1',
    metadata: { id: blockType, ...(category ? { category } : {}) },
    position: { x: 0, y: 0 },
    config: { tool: blockType, params },
    inputs: {},
    outputs: {},
    enabled: true,
    ...(retry ? { retry: retry as SerializedBlock['retry'] } : {}),
  }
}

describe('resolveBlockRetryConfig', () => {
  it('clamps out-of-range values to the bounds rather than rejecting them', () => {
    expect(
      resolveBlockRetryConfig({ enabled: true, maxTries: 99, waitBetweenTriesMs: 10_000_000 })
    ).toEqual({
      enabled: true,
      maxTries: BLOCK_RETRY_MAX_TRIES,
      waitBetweenTriesMs: BLOCK_RETRY_MAX_WAIT_MS,
    })

    expect(
      resolveBlockRetryConfig({ enabled: true, maxTries: -4, waitBetweenTriesMs: -1 })
    ).toEqual({
      enabled: true,
      maxTries: BLOCK_RETRY_MIN_TRIES,
      waitBetweenTriesMs: 0,
    })
  })

  /**
   * `Number(null)` and `Number('')` are both `0`, so a missing field must be
   * recognized before the numeric conversion — otherwise an unset wait reads as
   * an explicit "no delay" instead of the default.
   */
  it('reads a missing field as unset rather than as zero', () => {
    expect(
      resolveBlockRetryConfig({
        enabled: true,
        maxTries: undefined,
        waitBetweenTriesMs: null as unknown as number,
      })
    ).toEqual({
      enabled: true,
      maxTries: BLOCK_RETRY_DEFAULT_TRIES,
      waitBetweenTriesMs: BLOCK_RETRY_DEFAULT_WAIT_MS,
    })
  })

  it('still honors an explicit zero wait', () => {
    expect(resolveBlockRetryConfig({ enabled: true, maxTries: 2, waitBetweenTriesMs: 0 })).toEqual({
      enabled: true,
      maxTries: 2,
      waitBetweenTriesMs: 0,
    })
  })
})

describe('resolveBlockRetryPolicy', () => {
  it('refuses to retry block types whose throw is not a failure', () => {
    const policy = { enabled: true, maxTries: 3, waitBetweenTriesMs: 0 }
    for (const blockType of [
      BlockType.HUMAN_IN_THE_LOOP,
      BlockType.SENTINEL_START,
      BlockType.SENTINEL_END,
      BlockType.LOOP,
      BlockType.PARALLEL,
    ]) {
      expect(resolveBlockRetryPolicy(block(blockType, policy))).toBeNull()
    }
  })

  it('refuses to retry a block acting as a trigger, matching what the editor offers', () => {
    const policy = { enabled: true, maxTries: 3, waitBetweenTriesMs: 0 }
    expect(
      resolveBlockRetryPolicy(block(BlockType.FUNCTION, policy, { triggerMode: true }))
    ).toBeNull()
    expect(resolveBlockRetryPolicy(block(BlockType.FUNCTION, policy, {}, 'triggers'))).toBeNull()
  })
})

describe('isRetryableBlockError', () => {
  it('never replays a child workflow, whose blocks already ran their own policies', () => {
    expect(
      isRetryableBlockError(
        new ChildWorkflowError({ message: 'child failed', childWorkflowName: 'Child' })
      )
    ).toBe(false)
  })

  it('finds a deliberate stop that a provider rewrapped, since name is overwritten', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const wrapped = new Error('Provider request failed', { cause: abort })
    wrapped.name = 'ProviderError'
    expect(isRetryableBlockError(wrapped)).toBe(false)
  })

  it('terminates on a self-referential cause chain', () => {
    const looping = new Error('looping') as Error & { cause?: unknown }
    looping.cause = looping
    expect(isRetryableBlockError(looping)).toBe(true)
  })
})
