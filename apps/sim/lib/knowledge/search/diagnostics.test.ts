/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logs = vi.hoisted(() => ({ info: vi.fn() }))
vi.mock('@sim/logger', () => ({ createLogger: () => logs }))

import {
  annotateSearchDiagnostics,
  measureSearchStage,
  withSearchDiagnostics,
} from '@/lib/knowledge/search/diagnostics'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] })
})
afterEach(() => vi.useRealTimers())

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('search pipeline diagnostics', () => {
  it('reports a stalled stage and clears its heartbeat on completion', async () => {
    const gate = deferred()
    const result = withSearchDiagnostics({ surface: 'copilot', toolCallId: 'fixture-tool' }, () =>
      measureSearchStage('embedding', () => gate.promise)
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(logs.info).toHaveBeenCalledWith(
      'Knowledge search still running',
      expect.objectContaining({
        toolCallId: 'fixture-tool',
        elapsedMs: 5000,
        activeStages: [{ stage: 'embedding', elapsedMs: 5000 }],
      })
    )
    gate.resolve()
    await result
    expect(logs.info).toHaveBeenLastCalledWith(
      'Knowledge search completed',
      expect.objectContaining({
        outcome: 'success',
        activeStages: [],
        stages: { embedding: { count: 1, totalMs: 5000, maxMs: 5000, errors: 0 } },
      })
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(logs.info).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps concurrent searches separate and emits only one summary for nested use cases', async () => {
    const first = deferred()
    const second = deferred()
    const a = withSearchDiagnostics({ surface: 'copilot', toolCallId: 'first' }, () =>
      withSearchDiagnostics({ topK: 15 }, async () => {
        await measureSearchStage('result_provenance', () => first.promise)
        annotateSearchDiagnostics({ resultCount: 15 })
      })
    )
    const b = withSearchDiagnostics({ surface: 'dashboard' }, () =>
      measureSearchStage('retrieval', () => second.promise)
    )
    await vi.advanceTimersByTimeAsync(25)
    second.resolve()
    await b
    await vi.advanceTimersByTimeAsync(50)
    first.resolve()
    await a
    expect(logs.info).toHaveBeenCalledTimes(2)
    const dashboard = logs.info.mock.calls[0][1]
    const assistant = logs.info.mock.calls[1][1]
    expect(dashboard).toMatchObject({ surface: 'dashboard', elapsedMs: 25 })
    expect(dashboard).not.toHaveProperty('toolCallId')
    expect(dashboard.stages).not.toHaveProperty('result_provenance')
    expect(assistant).toMatchObject({
      toolCallId: 'first',
      topK: 15,
      resultCount: 15,
      elapsedMs: 75,
    })
    expect(assistant.searchId).not.toBe(dashboard.searchId)
    expect(assistant.stages).not.toHaveProperty('retrieval')
  })

  it('preserves failures, records repeated stage errors, and does not log error content', async () => {
    const error = new Error('private provider response')
    await expect(
      withSearchDiagnostics({ surface: 'copilot' }, async () => {
        await measureSearchStage('vector.authorization', () => 'allowed')
        return measureSearchStage('vector.authorization', () => {
          throw error
        })
      })
    ).rejects.toBe(error)
    expect(logs.info).toHaveBeenLastCalledWith(
      'Knowledge search completed',
      expect.objectContaining({
        outcome: 'error',
        stages: {
          'vector.authorization': { count: 2, totalMs: 0, maxMs: 0, errors: 1 },
        },
      })
    )
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain(error.message)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports tool failures returned as values without changing the result', async () => {
    const result = { success: false, message: 'private error' }
    expect(await withSearchDiagnostics({}, async () => result)).toBe(result)
    expect(logs.info.mock.calls[0][1].outcome).toBe('error')
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain(result.message)
  })

  it('does not create diagnostics outside a search invocation', async () => {
    expect(await measureSearchStage('embedding', () => 42)).toBe(42)
    expect(logs.info).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
