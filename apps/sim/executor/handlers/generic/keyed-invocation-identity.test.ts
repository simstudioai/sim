/**
 * Pins the two properties a `keyed` delivery's idempotency token depends on, at
 * the layer that supplies them.
 *
 * A token has to be BOTH stable and distinguishing, and each property fails in
 * an opposite, equally bad direction:
 *
 * - Not stable  -> a retry after a committed write mints a fresh token, the
 *                  provider cannot collapse it, and the customer is charged twice.
 * - Not distinct -> five loop iterations paying five different invoices derive
 *                  one token, the provider honours the first and silently drops
 *                  four real payments. That looks like five successes, which is
 *                  strictly worse than the duplicate.
 *
 * `nodeMetadata.executionOrder` carries both halves because the block executor
 * assigns it once per invocation, before the retry wrapper.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
  isMcpTool: () => false,
}))

import { deriveDeliveryKey } from '@/lib/core/http/derive-key'

describe('keyed invocation identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives the same token for every retry layer of one invocation', () => {
    const context = {
      executionId: 'exec-1',
      blockId: 'block-1',
      toolId: 'square_create_payment',
      invocationId: '7',
    }

    const transportAttempt = deriveDeliveryKey(context, context.toolId)
    const hostedKeyAttempt = deriveDeliveryKey(context, context.toolId)
    const blockRetryAttempt = deriveDeliveryKey({ ...context }, context.toolId)

    expect(hostedKeyAttempt).toBe(transportAttempt)
    expect(blockRetryAttempt).toBe(transportAttempt)
  })

  it('derives a DIFFERENT token per loop iteration of the same block', () => {
    const base = {
      executionId: 'exec-1',
      blockId: 'block-1',
      toolId: 'square_create_payment',
    }

    const perIteration = ['1', '2', '3', '4', '5'].map((invocationId) =>
      deriveDeliveryKey({ ...base, invocationId }, base.toolId)
    )

    expect(new Set(perIteration).size).toBe(5)
  })

  it('separates two different blocks inside one execution', () => {
    const a = deriveDeliveryKey(
      {
        executionId: 'exec-1',
        blockId: 'block-a',
        toolId: 'brex_create_transfer',
        invocationId: '1',
      },
      'brex_create_transfer'
    )
    const b = deriveDeliveryKey(
      {
        executionId: 'exec-1',
        blockId: 'block-b',
        toolId: 'brex_create_transfer',
        invocationId: '1',
      },
      'brex_create_transfer'
    )

    expect(a).not.toBe(b)
  })

  it('separates the same block across two executions', () => {
    const first = deriveDeliveryKey(
      {
        executionId: 'exec-1',
        blockId: 'block-1',
        toolId: 'brex_create_transfer',
        invocationId: '1',
      },
      'brex_create_transfer'
    )
    const second = deriveDeliveryKey(
      {
        executionId: 'exec-2',
        blockId: 'block-1',
        toolId: 'brex_create_transfer',
        invocationId: '1',
      },
      'brex_create_transfer'
    )

    expect(first).not.toBe(second)
  })
})
