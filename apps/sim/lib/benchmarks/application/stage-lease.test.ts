import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { renew } = vi.hoisted(() => ({ renew: vi.fn() }))
vi.mock('@/lib/benchmarks/repository', () => ({ renewBenchmarkStage: renew }))

import { withBenchmarkStageLease } from '@/lib/benchmarks/application/stage-lease'

/** Covers healthy runs beyond the old cutoff, loss of ownership, and caller cancellation. */
describe('benchmark stage lifetime', () => {
  const attempt = {
    organizationId: 'org',
    userId: 'operator',
    benchmarkId: 'benchmark',
    version: 2,
    stage: 'distill' as const,
    attemptId: 'attempt',
  }

  beforeEach(() => {
    vi.useFakeTimers()
    renew.mockResolvedValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a healthy inspection alive beyond ten minutes and stops its heartbeat on completion', async () => {
    const result = withBenchmarkStageLease(attempt, undefined, async (signal) => {
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      signal.throwIfAborted()
      return 'complete reference'
    })
    await expect(result).resolves.toBe('complete reference')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, new Error('database unavailable')])(
    'aborts the inspection when its ownership cannot be renewed (%s)',
    async (outcome) => {
      if (outcome instanceof Error) renew.mockRejectedValue(outcome)
      else renew.mockResolvedValue(outcome)
      const result = withBenchmarkStageLease(attempt, undefined, async (signal) => {
        await vi.advanceTimersByTimeAsync(60_000)
        signal.throwIfAborted()
      }).catch((error: unknown) => error)
      await expect(result).resolves.toMatchObject({ code: 'conflict' })
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('propagates caller cancellation and clears its heartbeat when work throws', async () => {
    const controller = new AbortController()
    const result = withBenchmarkStageLease(attempt, controller.signal, async (signal) => {
      controller.abort(new Error('cancelled by caller'))
      signal.throwIfAborted()
    })
    await expect(result).rejects.toThrow('cancelled by caller')
    expect(vi.getTimerCount()).toBe(0)
  })
})
