/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAttributedUsageLimits,
  mockSubscribe,
  mockUnsubscribe,
  mockIsExecutionCancelled,
  mockIsRedisCancellationEnabled,
} = vi.hoisted(() => ({
  mockCheckAttributedUsageLimits: vi.fn(),
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
  mockIsExecutionCancelled: vi.fn(),
  mockIsRedisCancellationEnabled: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  getCancellationChannel: () => ({ subscribe: mockSubscribe }),
  isExecutionCancelled: mockIsExecutionCancelled,
  isRedisCancellationEnabled: mockIsRedisCancellationEnabled,
}))

import {
  admitCustomBlockChildExecution,
  buildCustomBlockCorrelation,
  CustomBlockAdmissionError,
  createChildCancellationSignal,
  trackChildFinalization,
  waitForChildFinalizations,
} from '@/lib/workflows/custom-blocks/child-execution'
import { isBoundarySafeError } from '@/executor/errors/boundary'

const attribution = { actorUserId: 'owner-1', workspaceId: 'workspace-source' } as any

describe('admitCustomBlockChildExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockReturnValue(mockUnsubscribe)
    mockIsRedisCancellationEnabled.mockReturnValue(true)
    mockIsExecutionCancelled.mockResolvedValue(false)
  })

  it('passes when the source payer has headroom', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })

    await expect(admitCustomBlockChildExecution(attribution)).resolves.toBeUndefined()
  })

  it('forwards the payer-scoped message, which describes the shared org', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      scope: 'payer',
      message: 'Organization usage limit exceeded: $50.00 pooled of $50.00 organization limit.',
    })

    await expect(admitCustomBlockChildExecution(attribution)).rejects.toThrow(
      'Organization usage limit exceeded: $50.00 pooled of $50.00 organization limit.'
    )
  })

  it("never forwards the owner's personal member-cap message to a consumer", async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      scope: 'member',
      message:
        'Member credit limit exceeded: 900 of 1,000 credits used. Ask an admin to raise your credit limit.',
    })

    const error = await admitCustomBlockChildExecution(attribution).catch((e: Error) => e)

    expect(error).toBeInstanceOf(CustomBlockAdmissionError)
    expect(error.message).not.toContain('Member credit limit')
    expect(error.message).not.toContain('900')
    expect(error.message).toBe(
      'This custom block is unavailable because a usage limit was reached. Ask an organization admin to review it.'
    )
  })

  it("never forwards the owner's account-block message to a consumer", async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      scope: 'actor',
      message: 'Account frozen. Please contact support to resolve this issue.',
    })

    const error = await admitCustomBlockChildExecution(attribution).catch((e: Error) => e)

    expect(error.message).not.toContain('Account frozen')
    expect(error.message).not.toContain('support')
  })

  it('takes no concurrency reservation', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })

    await admitCustomBlockChildExecution(attribution)

    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledTimes(1)
  })
})

describe('buildCustomBlockCorrelation', () => {
  it('records the invoking run without naming anything', () => {
    const correlation = buildCustomBlockCorrelation({
      invokerExecutionId: 'exec-1',
      invokerRequestId: 'req-1',
      invokerWorkflowId: 'wf-1',
      invokerWorkspaceId: 'ws-consumer',
      blockType: 'custom_block_abc',
    })

    expect(correlation).toEqual({
      source: 'custom_block',
      executionId: 'exec-1',
      requestId: 'req-1',
      workflowId: 'wf-1',
      triggerType: 'custom_block_abc',
      invokerWorkspaceId: 'ws-consumer',
    })
  })

  it('is undefined without an invoking execution id', () => {
    expect(buildCustomBlockCorrelation({ blockType: 'custom_block_abc' })).toBeUndefined()
  })
})

describe('createChildCancellationSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockReturnValue(mockUnsubscribe)
    mockIsRedisCancellationEnabled.mockReturnValue(true)
    mockIsExecutionCancelled.mockResolvedValue(false)
  })

  it('aborts when the parent signal aborts', async () => {
    const parent = new AbortController()
    const { signal } = await createChildCancellationSignal({
      parentSignal: parent.signal,
      parentExecutionId: 'parent-1',
    })

    expect(signal.aborted).toBe(false)
    parent.abort()
    expect(signal.aborted).toBe(true)
  })

  it('starts aborted when the parent already aborted', async () => {
    const parent = new AbortController()
    parent.abort()

    const { signal } = await createChildCancellationSignal({ parentSignal: parent.signal })

    expect(signal.aborted).toBe(true)
  })

  it('aborts on the parent cancellation event, and ignores other runs', async () => {
    const { signal } = await createChildCancellationSignal({ parentExecutionId: 'parent-1' })
    const handler = mockSubscribe.mock.calls[0][0]

    handler({ executionId: 'someone-else' })
    expect(signal.aborted).toBe(false)

    handler({ executionId: 'parent-1' })
    expect(signal.aborted).toBe(true)
  })

  it('unsubscribes on dispose so a looped block leaks nothing', async () => {
    const parent = new AbortController()
    const { dispose } = await createChildCancellationSignal({
      parentSignal: parent.signal,
      parentExecutionId: 'parent-1',
    })

    dispose()

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('CustomBlockAdmissionError', () => {
  it('is boundary-safe so the consumer sees a usage-limit classification', () => {
    const error = new CustomBlockAdmissionError('Organization usage limit exceeded')

    expect(isBoundarySafeError(error)).toBe(true)
    expect(error.errorType).toBe('usage_limit')
    expect(error.message).toBe('Organization usage limit exceeded')
  })
})

describe('createChildCancellationSignal durable backstop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockReturnValue(mockUnsubscribe)
    mockIsRedisCancellationEnabled.mockReturnValue(true)
    mockIsExecutionCancelled.mockResolvedValue(false)
  })

  it('aborts on a cancel published before the bridge subscribed', async () => {
    // The pub/sub event is long gone; only the durable key remains.
    mockIsExecutionCancelled.mockResolvedValue(true)

    const { signal } = await createChildCancellationSignal({ parentExecutionId: 'parent-1' })

    expect(mockIsExecutionCancelled).toHaveBeenCalledWith('parent-1')
    expect(signal.aborted).toBe(true)
  })

  it('subscribes before reading the durable key so no window is left open', async () => {
    const order: string[] = []
    mockSubscribe.mockImplementation(() => {
      order.push('subscribe')
      return mockUnsubscribe
    })
    mockIsExecutionCancelled.mockImplementation(async () => {
      order.push('durable-read')
      return false
    })

    await createChildCancellationSignal({ parentExecutionId: 'parent-1' })

    expect(order).toEqual(['subscribe', 'durable-read'])
  })

  it('fails open when the durable read throws', async () => {
    mockIsExecutionCancelled.mockRejectedValue(new Error('redis down'))

    const { signal } = await createChildCancellationSignal({ parentExecutionId: 'parent-1' })

    expect(signal.aborted).toBe(false)
  })

  it('skips the durable read when redis cancellation is unavailable', async () => {
    mockIsRedisCancellationEnabled.mockReturnValue(false)

    const { signal } = await createChildCancellationSignal({ parentExecutionId: 'parent-1' })

    expect(mockIsExecutionCancelled).not.toHaveBeenCalled()
    expect(signal.aborted).toBe(false)
  })
})

describe('child finalization tracking', () => {
  it('lets an invoking run await a finalization the engine abandoned', async () => {
    let resolveWrite: () => void = () => {}
    const durableWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    let finished = false
    const finalization = durableWrite.then(() => {
      finished = true
    })

    trackChildFinalization('invoker-1', finalization)

    // The engine returned without draining; the write is still in flight.
    expect(finished).toBe(false)

    const drained = waitForChildFinalizations('invoker-1')
    resolveWrite()
    await drained

    expect(finished).toBe(true)
  })

  it('does not let a rejected finalization break the drain', async () => {
    trackChildFinalization('invoker-2', Promise.reject(new Error('db down')))

    await expect(waitForChildFinalizations('invoker-2')).resolves.toBeUndefined()
  })

  it('is a no-op for a run that registered nothing', async () => {
    await expect(waitForChildFinalizations('invoker-never')).resolves.toBeUndefined()
    await expect(waitForChildFinalizations(undefined)).resolves.toBeUndefined()
  })

  it('releases its entry so a run that never drains cannot leak', async () => {
    const finalization = Promise.resolve()
    trackChildFinalization('invoker-3', finalization)
    await finalization
    await Promise.resolve()

    // Draining after self-cleanup still resolves rather than hanging.
    await expect(waitForChildFinalizations('invoker-3')).resolves.toBeUndefined()
  })
})
