/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  canBuild: true,
  urlUpdate: vi.fn(),
  searchChange: vi.fn(),
  summarize: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'organization-a', name: 'Acme' },
    canBuild: mocks.canBuild,
    searchAccess: { memberScoped: true },
  }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({ useWorkspaceKnowledgeSearch: mocks.search }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: () => ({ data: { knowledgeBaseId: 'index-a' }, isPending: false }),
  useSearchSourceOverview: () => ({ data: { providers: [], hasSearchableDocuments: true } }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags',
  () => ({
    isHttpUrl: () => true,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({
    SourceCard: ({
      source,
      onSummarize,
    }: {
      source: SourceTagData
      onSummarize: (source: SourceTagData) => void
    }) => (
      <>
        <a href={source.url} data-source-link>
          {source.title}
        </a>
        <button type='button' onClick={() => onSummarize(source)}>
          Summarize
        </button>
      </>
    ),
  })
)

import { SearchResultsView } from '@/app/o/[organizationId]/search/search-results-view'

const scope: ResourceScope = { kind: 'organization', organizationId: 'organization-a' }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canBuild = true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  mocks.search.mockImplementation((_scope: ResourceScope, query: string) => {
    const result: WorkspaceKnowledgeSearchResult = {
      documentId: `document-${query}`,
      knowledgeBaseId: 'index-a',
      knowledgeBaseName: 'Organization Search',
      documentName: `${query} launch plan`,
      sourceUrl: `https://fixture.test/${encodeURIComponent(query)}`,
      connectorType: null,
      sourceModifiedAt: null,
      author: null,
      content: `${query} release milestones`,
      chunkIndex: 0,
      similarity: 1,
    }
    return {
      data: { query, results: [result], retrieval: { status: 'complete', timedOutLegs: [] } },
      isPending: false,
      isFetching: false,
      isError: false,
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(searchParams = '') {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.urlUpdate}>
        <SearchResultsView
          query={new URLSearchParams(searchParams).get('q') ?? ''}
          composer={<div data-composer>Search composer</div>}
          onSearchChange={mocks.searchChange}
          onSummarize={mocks.summarize}
        />
      </NuqsTestingAdapter>
    )
  )
}

describe('results-only search layout', () => {
  it('shows the organization header and composer before any query', async () => {
    await render()
    expect(container.textContent).toContain('Search Acme')
    expect(container.querySelector('[data-composer]')).not.toBeNull()
    expect(mocks.search).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Get started')
  })
  it('keeps the original result rows and shares their exact retrieval address with the panel', async () => {
    await render('?q=Orion&source=slack&updated=7d')
    expect(container.querySelector('a[data-source-link]')?.textContent).toBe('Orion launch plan')
    const filters = mocks.search.mock.calls.at(-1)![2]
    expect(filters.source).toBe('slack')
    expect(mocks.searchChange).toHaveBeenLastCalledWith({ scope, query: 'Orion', filters })
    expect(mocks.search).toHaveBeenLastCalledWith(scope, 'Orion', filters, 20, {
      retainAcrossLimits: true,
    })
  })
  it('summarizes the selected document through Home without duplicating search state', async () => {
    await render('?q=Orion')
    const button = [...container.querySelectorAll('button')].find(
      (entry) => entry.textContent === 'Summarize'
    )!
    await act(async () => button.click())
    expect(mocks.summarize).toHaveBeenCalledWith('Summarize "Orion launch plan"', {
      documentIds: ['document-Orion'],
    })
  })
})
