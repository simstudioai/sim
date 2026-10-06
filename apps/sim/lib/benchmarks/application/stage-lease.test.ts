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
    get leaseExpiresAt() {
      return new Date(Date.now() + 120_000)
    },
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

  it('aborts the inspection immediately when ownership is explicitly lost', async () => {
    renew.mockResolvedValue(false)
    const result = withBenchmarkStageLease(attempt, undefined, async (signal) => {
      await vi.advanceTimersByTimeAsync(60_000)
      signal.throwIfAborted()
    }).catch((error: unknown) => error)
    await expect(result).resolves.toMatchObject({ code: 'conflict' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('survives a transient renewal failure while the acknowledged lease is still valid', async () => {
    renew.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      withBenchmarkStageLease(attempt, undefined, async (signal) => {
        await vi.advanceTimersByTimeAsync(30_000)
        signal.throwIfAborted()
        await vi.advanceTimersByTimeAsync(180_000)
        signal.throwIfAborted()
        return 'finished'
      })
    ).resolves.toBe('finished')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('expires ownership at the last acknowledged lease when renewals keep failing', async () => {
    renew.mockRejectedValue(new Error('database unavailable'))
    await expect(
      withBenchmarkStageLease(attempt, undefined, async (signal) => {
        await vi.advanceTimersByTimeAsync(119_999)
        expect(signal.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        signal.throwIfAborted()
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('expires a hung renewal independently of the query and clears every timer', async () => {
    renew.mockImplementation(() => new Promise(() => {}))
    const run = withBenchmarkStageLease(attempt, undefined, () => new Promise(() => {})).catch(
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await run).toMatchObject({ code: 'conflict' })
    expect(vi.getTimerCount()).toBe(0)
  })

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
