import { createDeferred } from '@sim/testing/helpers'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  describeSearchRequest,
  documentKindLabel,
  measureSearchStage,
  recordSearchProviderResult,
  withSearchDiagnostics,
  withSearchProviderDiagnostics,
  withSearchRequestDiagnostics,
} from '@/lib/knowledge/search/diagnostics'
import { LiveReadError } from '@/lib/sim-search/live/read-error'

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

  it('describes a search request without its text, modifiers, cursor, or account', () => {
    const shape = describeSearchRequest({
      query: '  private launch   plan ',
      filters: {
        startDate: '2026-10-30T00:00:00Z',
        endDate: '2026-11-13T12:00:00Z',
        sortBy: 'newest',
      },
      nativeQueries: [
        {
          provider: 'slack',
          query: 'private decision',
          modifiers: 'in:#private-channel',
          cursor: 'private-cursor',
          accountId: 'private-account',
          termClauses: ['private term'],
        },
        { provider: 'jira', query: '', kind: 'issues' },
      ],
    })
    expect(shape).toEqual({
      queryTermCount: 3,
      sortBy: 'newest',
      dateWindowDays: 14.5,
      nativeQueries: [
        {
          provider: 'slack',
          hasText: true,
          hasModifiers: true,
          hasCursor: true,
          hasProject: false,
          targetsAccount: true,
          keywordOnly: false,
          termClauseCount: 1,
        },
        {
          provider: 'jira',
          kind: 'issues',
          hasText: false,
          hasModifiers: false,
          hasCursor: false,
          hasProject: false,
          targetsAccount: false,
          keywordOnly: false,
          termClauseCount: 0,
        },
      ],
    })
    expect(JSON.stringify(shape)).not.toContain('private')
  })

  it('keeps a document kind only when it is a bounded token', () => {
    expect(documentKindLabel('file')).toBe('file')
    expect(documentKindLabel('application/vnd.google-apps.document')).toBe(
      'application/vnd.google-apps.document'
    )
    expect(documentKindLabel('Quarterly plan for a private customer')).toBe('other')
    expect(documentKindLabel('ProjectAtlas_Q3')).toBe('other')
    expect(documentKindLabel('atlas-launch-notes')).toBe('other')
    expect(documentKindLabel('notes/atlas')).toBe('other')
    expect(documentKindLabel(undefined)).toBeUndefined()
  })

  it('names the class of a failure that ends a trace, never its message', async () => {
    const failures = [
      new OrchestrationError('not_found', 'private document title is gone'),
      new LiveReadError('private provider text', true),
      new Error('private unexpected text'),
    ]
    for (const error of failures)
      await expect(
        withSearchDiagnostics({ operation: 'read_document' }, async () => {
          throw error
        })
      ).rejects.toBe(error)
    const summaries = logs.info.mock.calls
      .filter(([message]) => message === 'Knowledge search completed')
      .slice(-3)
      .map(([, fields]) => fields?.failure)
    expect(summaries).toEqual([
      { reason: 'not_found' },
      { reason: 'provider_retryable' },
      { reason: 'unexpected_error' },
    ])
    const logged = JSON.stringify(logs.info.mock.calls)
    for (const error of failures) expect(logged).not.toContain(error.message)
  })

  it('keeps the failure class when an outer tool call turns the error into a result', async () => {
    await withSearchDiagnostics({ surface: 'copilot' }, async () => {
      try {
        await withSearchDiagnostics({ operation: 'read_document' }, async () => {
          throw new OrchestrationError('not_found', 'private document title is gone')
        })
      } catch {
        return { success: false }
      }
    })
    expect(logs.info).toHaveBeenLastCalledWith(
      'Knowledge search completed',
      expect.objectContaining({
        surface: 'copilot',
        outcome: 'error',
        failure: { reason: 'not_found' },
      })
    )
  })
})
