import { createDeferred } from '@sim/testing/helpers'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  measureSearchStage,
  recordSearchProviderResult,
  withSearchDiagnostics,
  withSearchProviderDiagnostics,
  withSearchRequestDiagnostics,
} from '@/lib/knowledge/search/diagnostics'

const logs = getMockLogger('KnowledgeSearchDiagnostics')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] })
})
afterEach(() => vi.useRealTimers())

describe('search pipeline diagnostics', () => {
  it('preserves failures, records repeated stage errors, and does not log error content', async () => {
    const error = new Error('private provider response')
    await expect(
      withSearchDiagnostics({ surface: 'copilot' }, async () => {
        await measureSearchStage('live.resolve', () => 'allowed')
        return measureSearchStage('live.resolve', () => {
          throw error
        })
      })
    ).rejects.toBe(error)
    expect(logs.info).toHaveBeenLastCalledWith(
      'Knowledge search completed',
      expect.objectContaining({
        outcome: 'error',
        stages: {
          'live.resolve': { count: 2, totalMs: 0, maxMs: 0, errors: 1 },
        },
      })
    )
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain(error.message)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates concurrent provider failures and retains errors caught by a search adapter', async () => {
    const error = Object.assign(new Error('private query, provider response, and credential'), {
      code: 'private credential',
      httpStatus: 403,
      diagnosticCode: 'provider_access_denied',
    })
    const result = await withSearchDiagnostics({ surface: 'dashboard' }, () =>
      Promise.all([
        withSearchProviderDiagnostics({ provider: 'gmail', accountIndex: 0 }, async () => {
          await measureSearchStage('live.search', () =>
            withSearchRequestDiagnostics({ transport: 'native_http', method: 'GET' }, async () => {
              await Promise.resolve()
              throw error
            }).catch(() => undefined)
          )
          recordSearchProviderResult({ status: 'partial', resultCount: 1 })
          return ['available result']
        }),
        withSearchProviderDiagnostics({ provider: 'github', accountIndex: 1 }, async () => {
          await measureSearchStage('live.verify', () =>
            withSearchRequestDiagnostics(
              { transport: 'native_http', method: 'GET' },
              async (record) => {
                record({ httpStatus: 200 })
              }
            )
          )
          recordSearchProviderResult({ status: 'ok', resultCount: 2 })
          return ['other result']
        }),
      ])
    )
    expect(result).toEqual([['available result'], ['other result']])
    const summaries = logs.info.mock.calls
      .filter(([message]) => message === 'Live search provider completed')
      .map(([, data]) => data)
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'gmail',
          requests: [
            expect.objectContaining({
              stage: 'live.search',
              outcome: 'error',
              failure: {
                reason: 'provider_access_denied',
                httpStatus: 403,
              },
            }),
          ],
          results: [{ status: 'partial', resultCount: 1 }],
        }),
        expect.objectContaining({
          provider: 'github',
          requests: [
            expect.objectContaining({ stage: 'live.verify', outcome: 'success', httpStatus: 200 }),
          ],
          results: [{ status: 'ok', resultCount: 2 }],
        }),
      ])
    )
    const serialized = JSON.stringify(logs.info.mock.calls)
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('available result')
    expect(serialized).not.toContain('other result')
    expect(new Set(summaries.map((summary) => summary.searchId)).size).toBe(1)
  })

  it('preserves cancellation and bounds request diagnostics without losing failure counts', async () => {
    const aborted = new DOMException('private cancellation reason', 'AbortError')
    await expect(
      withSearchDiagnostics({}, () =>
        withSearchProviderDiagnostics({ provider: 'gmail', accountIndex: 0 }, async () => {
          for (let index = 0; index < 140; index++) {
            await withSearchRequestDiagnostics(
              { transport: 'native_http', method: 'GET' },
              async () => {
                throw Object.assign(new Error('private failure'), { code: 'ECONNRESET' })
              }
            ).catch(() => undefined)
          }
          return withSearchRequestDiagnostics(
            { transport: 'native_http', method: 'GET' },
            async () => {
              throw aborted
            }
          )
        })
      )
    ).rejects.toBe(aborted)
    expect(logs.info).toHaveBeenCalledWith(
      'Live search provider completed',
      expect.objectContaining({
        requestCount: 141,
        failedRequestCount: 141,
        omittedRequestCount: 13,
        outcome: 'error',
        failure: { reason: 'aborted' },
      })
    )
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain('private')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('records preview failures that settle after the search has returned', async () => {
    const pending = createDeferred<void>()
    let request: Promise<unknown> | undefined
    await withSearchDiagnostics({}, () =>
      withSearchProviderDiagnostics({ provider: 'gmail', accountIndex: 0 }, async () => {
        request = withSearchRequestDiagnostics(
          { transport: 'native_http', method: 'GET' },
          () => pending.promise
        ).catch(() => undefined)
      })
    )
    expect(logs.info).toHaveBeenCalledWith(
      'Live search provider completed',
      expect.objectContaining({ pendingRequestCount: 1 })
    )
    pending.reject(new DOMException('private preview content', 'AbortError'))
    await request
    expect(logs.info).toHaveBeenLastCalledWith(
      'Live search request completed after provider',
      expect.objectContaining({
        requestIndex: 0,
        outcome: 'error',
        failure: { reason: 'aborted' },
      })
    )
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain('private preview content')
  })
})
