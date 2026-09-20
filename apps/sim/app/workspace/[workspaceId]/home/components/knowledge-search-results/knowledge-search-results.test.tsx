/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  overview: vi.fn(),
  search: vi.fn(),
  retry: vi.fn(),
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: mocks.index,
  useSearchSourceOverview: mocks.overview,
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useWorkspaceKnowledgeSearch: mocks.search,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({ SourceCard: ({ source }: { source: { title: string } }) => <span>{source.title}</span> })
)

import type { ResourceScope } from '@/lib/core/resource-scope'
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/knowledge-search-results'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.index.mockReturnValue({ data: { knowledgeBaseId: 'index' }, isPending: false })
  mocks.search.mockReturnValue({
    data: { query: 'launch', results: [], retrieval: { status: 'complete', timedOutLegs: [] } },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: mocks.retry,
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})
async function render(
  scope: ResourceScope = { kind: 'workspace', workspaceId: 'workspace' },
  searchParams = ''
) {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter searchParams={searchParams}>
        <KnowledgeSearchResults scope={scope} query='launch' onSummarize={vi.fn()} />
      </NuqsTestingAdapter>
    )
  )
}

describe('source indexing context in search results', () => {
  it('uses provider overview state independently of loaded source pages', async () => {
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          { connectorType: 'google_drive', isSyncing: true },
          { connectorType: 'slack', isSyncing: false },
        ],
        hasSearchableDocuments: false,
      },
    })
    await render()
    expect(mocks.overview).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'workspace' })
    expect(container.textContent).toContain('Google Drive')
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).toContain('Still indexing Google Drive;')
  })
  it('does not invent indexing progress while the overview is unavailable', async () => {
    mocks.overview.mockReturnValue({ data: undefined })
    await render()
    expect(container.textContent).not.toContain('Still indexing')
    expect(container.textContent).toContain('Search found no results.')
  })
})

describe('incomplete search coverage', () => {
  it.each([false, true])(
    'distinguishes incomplete retrieval and permits retry (hasResults=%s)',
    async (hasResults) => {
      mocks.overview.mockReturnValue({
        data: { providers: [{ connectorType: 'gmail', isSyncing: true }] },
      })
      mocks.search.mockReturnValue({
        data: {
          query: 'launch',
          results: hasResults
            ? [
                {
                  documentId: 'document-1',
                  knowledgeBaseId: 'index',
                  knowledgeBaseName: 'Search index',
                  documentName: 'Release plan',
                  sourceUrl: 'https://fixture.test/release',
                  connectorType: null,
                  sourceModifiedAt: null,
                  author: null,
                  content: 'launch details',
                  chunkIndex: 0,
                  similarity: 0.9,
                },
              ]
            : [],
          retrieval: { status: 'partial', timedOutLegs: ['vector'] },
        },
        isPending: false,
        isFetching: false,
        isError: false,
        refetch: mocks.retry,
      })
      await render()
      expect(container.textContent).not.toContain('Search couldn’t run')
      expect(container.textContent).not.toContain('No documents')
      expect(container.textContent).toContain(
        hasResults ? '1 document · some results may be missing.' : 'Search timed out.'
      )
      expect(container.textContent).not.toContain('Search found no results.')
      expect(container.textContent).not.toContain('Still indexing')
      if (hasResults) expect(container.textContent).toContain('Release plan')
      const retry = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Try again'
      )
      expect(retry).toBeDefined()
      await act(async () => retry?.click())
      expect(mocks.retry).toHaveBeenCalledOnce()
    }
  )
})

describe('source setup navigation', () => {
  it.each([
    [{ kind: 'workspace', workspaceId: 'workspace' }, '/workspace/workspace/knowledge'],
    [{ kind: 'organization', organizationId: 'organization' }, '/o/organization/integrations'],
  ] as const)('links empty results to the source page for %j', async (scope, href) => {
    mocks.index.mockReturnValue({ data: { knowledgeBaseId: null }, isPending: false })
    mocks.overview.mockReturnValue({ data: undefined })
    await render(scope)
    expect(container.textContent).toContain('No sources are set up yet.')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(href)
  })
})

describe('result paging and the custom window', () => {
  const result = (n: number) => ({
    documentId: `doc-${n}`,
    knowledgeBaseId: 'kb',
    knowledgeBaseName: 'Index',
    documentName: `Document ${n}`,
    sourceUrl: null,
    connectorType: 'slack',
    sourceModifiedAt: null,
    author: null,
    content: 'launch notes',
    chunkIndex: 0,
    similarity: 0.5,
  })

  it('offers more only after a full first page, and asks for the wider search on request', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [], hasSearchableDocuments: true } })
    const page = (length: number) => ({
      data: {
        query: 'launch',
        results: Array.from({ length }, (_, n) => result(n)),
        retrieval: { status: 'complete', timedOutLegs: [] },
      },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: mocks.retry,
    })
    mocks.search.mockReturnValue(page(20))
    await render()
    expect(mocks.search.mock.calls.at(-1)![3]).toBe(20)
    const more = () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Show more')
    expect(more()).toBeDefined()
    await act(async () => more()!.click())
    /** The wider search is its own request; the first paint was never widened. */
    expect(mocks.search.mock.calls.at(-1)![3]).toBe(50)
    expect(more()).toBeUndefined()
    mocks.search.mockReturnValue(page(7))
    await render()
    expect(more()).toBeUndefined()
  })

  it('starts a refined search over at the first page after the reader asked for more', async () => {
    mocks.overview.mockReturnValue({
      data: {
        providers: [{ connectorType: 'slack', isSyncing: false }],
        hasSearchableDocuments: true,
      },
    })
    mocks.search.mockReturnValue({
      data: {
        query: 'launch',
        results: Array.from({ length: 20 }, (_, n) => result(n)),
        retrieval: { status: 'complete', timedOutLegs: [] },
      },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: mocks.retry,
    })
    await render()
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === label)!
    await act(async () => button('Show more').click())
    expect(mocks.search.mock.calls.at(-1)![3]).toBe(50)
    await act(async () => button('Slack').click())
    expect(mocks.search.mock.calls.at(-1)![2]).toEqual({ source: 'slack' })
    expect(mocks.search.mock.calls.at(-1)![3]).toBe(20)
  })

  it('drops the custom days when another window is chosen', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [], hasSearchableDocuments: true } })
    mocks.search.mockReturnValue({
      data: { query: 'launch', results: [], retrieval: { status: 'complete', timedOutLegs: [] } },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: mocks.retry,
    })
    await render(undefined, '?updated=custom&from=2026-09-01&to=2026-09-10')
    expect(mocks.search.mock.calls.at(-1)![2]).toHaveProperty('modifiedBefore')
    const anyTime = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Any time'
    )!
    await act(async () => anyTime.click())
    expect(mocks.search.mock.calls.at(-1)![2]).toEqual({})
  })

  it('searches nothing while a custom window has no days yet', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [], hasSearchableDocuments: true } })
    mocks.search.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: mocks.retry,
    })
    await render(undefined, '?updated=custom')
    expect(mocks.search.mock.calls.at(-1)![1]).toBe('')
    expect(container.textContent).toContain('Choose the days to search.')
  })

  it('searches a custom window as an inclusive range of days', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [], hasSearchableDocuments: true } })
    mocks.search.mockReturnValue({
      data: { query: 'launch', results: [], retrieval: { status: 'complete', timedOutLegs: [] } },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: mocks.retry,
    })
    await render(undefined, '?updated=custom&from=2026-09-01&to=2026-09-10')
    const filters = mocks.search.mock.calls.at(-1)![2]
    /** The days are the reader's own: local midnight to the last millisecond of the local day. */
    expect(filters.modifiedAfter).toBe(new Date(2026, 8, 1).toISOString())
    expect(filters.modifiedBefore).toBe(new Date(2026, 8, 11, 0, 0, 0, -1).toISOString())
  })
})
