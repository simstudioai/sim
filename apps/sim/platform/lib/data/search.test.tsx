/**
 * @vitest-environment jsdom
 *
 * Summarize hands one search result to a conversation that may not be mounted yet. Failure modes: a
 * row offering it with no Assistant to send to, or while its results are still changing; a summary
 * that reads the whole search rather than its document; a summary sent while the viewer is still on
 * Search; one sent twice as the conversation re-renders; and one stranded when the viewer starts over.
 */

import { act } from 'react'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
import type { SearchSourceRow } from '@/app/(product)/_components/search/model'
import { type SummaryRequest, useSendSummary } from '@/platform/lib/data/search-summary'

const mocks = vi.hoisted(() => ({
  organization: { id: 'org-1', name: 'Org', mothershipAvailable: true },
  params: {} as Record<string, unknown>,
  search: { isFetching: false },
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('nuqs', () => ({
  useQueryStates: () => [
    mocks.params,
    (next: Record<string, unknown>) => {
      Object.assign(mocks.params, next)
      return Promise.resolve()
    },
  ],
}))
vi.mock('@/platform/lib/data/organization', () => ({
  useOrganization: () => ({
    organization: { id: mocks.organization.id, name: mocks.organization.name },
    mothershipAvailable: mocks.organization.mothershipAvailable,
  }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useWorkspaceKnowledgeSearch: () => ({
    data: {
      retrieval: { status: 'complete' },
      results: [
        {
          documentId: 'doc-1',
          documentName: 'Renewal plan',
          knowledgeBaseId: 'kb-1',
          knowledgeBaseName: 'Drive',
          sourceUrl: 'https://example.com/renewal',
          content: 'The renewal plan',
        },
      ],
    },
    isPending: false,
    isFetching: mocks.search.isFetching,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/queries/search-history', () => ({
  useSearchHistory: () => ({ data: undefined, isPending: true, isError: false }),
  useClearSearchHistory: () => ({ mutate: vi.fn() }),
  useRecordSearchHistory: () => ({ mutate: vi.fn() }),
}))

import { useSearchSurface } from '@/platform/lib/data/search'

const SESSION = {
  data: { user: { id: 'viewer' } },
  isPending: false,
  error: null,
  refetch: async () => {},
} as SessionHookResult
const mounted: Root[] = []

function renderHook<P, T>(useHook: (props: P) => T, initialProps: P) {
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  const result = { current: undefined as T }
  function Probe({ props }: { props: P }) {
    result.current = useHook(props)
    return null
  }
  const client = new QueryClient()
  const rerender = (props: P = initialProps) =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <SessionContext.Provider value={SESSION}>
            <Probe props={props} />
          </SessionContext.Provider>
        </QueryClientProvider>
      )
    )
  rerender(initialProps)
  return { result, rerender }
}

function surfaceAtSearch() {
  const hook = renderHook(() => useSearchSurface(undefined), undefined)
  const row = hook.result.current.results.rows[0] as SearchSourceRow
  return { ...hook, row }
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
})

beforeEach(() => {
  mocks.organization.mothershipAvailable = true
  mocks.search.isFetching = false
  mocks.params = {
    q: 'renewal',
    mode: 'search',
    source: null,
    updated: '7d',
    from: null,
    to: null,
  }
})

describe('Summarize on a search result', () => {
  it('is offered once the results settle and Assistant can answer', () => {
    expect(surfaceAtSearch().result.current.results.onSummarize).toBeTypeOf('function')
  })

  it('is not offered while the results may still change', () => {
    mocks.search.isFetching = true
    expect(surfaceAtSearch().result.current.results.onSummarize).toBeUndefined()
  })

  it('is not offered without an Assistant', () => {
    mocks.organization.mothershipAvailable = false
    expect(surfaceAtSearch().result.current.results.onSummarize).toBeUndefined()
  })

  it('switches to Assistant and scopes the summary to that document under the same filters', () => {
    const { result, rerender, row } = surfaceAtSearch()
    act(() => result.current.results.onSummarize?.(row))
    expect(mocks.params.mode).toBe('assistant')
    rerender()
    const pending = result.current.pendingSummary
    expect(pending?.message).toBe('Summarize "Renewal plan"')
    expect(pending?.assistantSearch.documentIds).toEqual(['doc-1'])
    expect(pending?.assistantSearch.modifiedAfter).toBeTruthy()
  })

  it('holds the summary while the viewer is reading Search', () => {
    const { result, rerender, row } = surfaceAtSearch()
    act(() => result.current.results.onSummarize?.(row))
    mocks.params.mode = 'search'
    rerender()
    expect(result.current.pendingSummary).toBeUndefined()
    mocks.params.mode = 'assistant'
    rerender()
    expect(result.current.pendingSummary?.message).toBe('Summarize "Renewal plan"')
  })

  it('hands over summaries oldest first, each leaving once consumed', () => {
    const { result, rerender, row } = surfaceAtSearch()
    const onSummarize = result.current.results.onSummarize
    act(() => {
      onSummarize?.(row)
      onSummarize?.({ ...row, id: 'doc-2', title: 'Second' })
    })
    rerender()
    expect(result.current.pendingSummary?.assistantSearch.documentIds).toEqual(['doc-1'])
    const first = result.current.pendingSummary?.id ?? ''
    act(() => result.current.consumeSummary(first))
    expect(result.current.pendingSummary?.assistantSearch.documentIds).toEqual(['doc-2'])
  })

  it('drops a waiting summary when the viewer starts a new search', () => {
    const { result, rerender, row } = surfaceAtSearch()
    act(() => result.current.results.onSummarize?.(row))
    mocks.params.mode = 'search'
    rerender()
    act(() => result.current.startNew())
    mocks.params.mode = 'assistant'
    rerender()
    expect(result.current.pendingSummary).toBeUndefined()
  })
})

describe('sending a summary into the conversation', () => {
  const first: SummaryRequest = { id: 'a', message: 'one', assistantSearch: { documentIds: ['1'] } }
  const second: SummaryRequest = {
    id: 'b',
    message: 'two',
    assistantSearch: { documentIds: ['2'] },
  }

  it('sends each request once across re-renders, consuming it as it goes', () => {
    const send = vi.fn()
    const onConsumed = vi.fn()
    const { rerender } = renderHook(
      (request: SummaryRequest) => useSendSummary({ request, onConsumed, send }),
      first
    )
    rerender(first)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(first)
    expect(onConsumed).toHaveBeenCalledWith('a')
    rerender(second)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(second)
  })

  it('sends nothing with no request waiting', () => {
    const send = vi.fn()
    renderHook(() => useSendSummary({ request: undefined, send }), undefined)
    expect(send).not.toHaveBeenCalled()
  })
})
