import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measureSearchStage, withSearchDiagnostics } from '@/lib/knowledge/search/diagnostics'

const logs = getMockLogger('KnowledgeSearchDiagnostics')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] })
})
afterEach(() => vi.useRealTimers())

function _deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('search pipeline diagnostics', () => {
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
})
