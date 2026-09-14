/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ overview: vi.fn(), search: vi.fn(), retry: vi.fn() }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: () => ({ data: { knowledgeBaseId: 'index' }, isPending: false }),
  useSearchSourceOverview: mocks.overview,
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useWorkspaceKnowledgeSearch: mocks.search,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({ SourceCard: ({ source }: { source: { title: string } }) => <span>{source.title}</span> })
)

import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/knowledge-search-results'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
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
async function render() {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter>
        <KnowledgeSearchResults workspaceId='workspace' query='launch' onSummarize={vi.fn()} />
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
    expect(container.textContent).not.toContain('Slack')
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
    'shows matches without timeout copy or retry controls (hasResults=%s)',
    async (hasResults) => {
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
      expect(container.textContent).not.toContain('Some results may be missing.')
      expect(container.textContent).not.toContain('Search is incomplete.')
      expect(container.textContent).toContain(
        hasResults ? '1 document' : 'Search found no results.'
      )
      if (hasResults) expect(container.textContent).toContain('Release plan')
      const retry = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Try again'
      )
      expect(retry).toBeUndefined()
      expect(mocks.retry).not.toHaveBeenCalled()
    }
  )
})
