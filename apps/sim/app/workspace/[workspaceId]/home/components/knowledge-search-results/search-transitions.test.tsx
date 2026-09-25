/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  userId: 'reader',
  summarize: vi.fn(),
  urlUpdate: vi.fn(),
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.userId } } }),
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/o/organization/search',
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'organization', name: 'Acme' },
    searchAccess: { memberScoped: true },
  }),
}))
vi.mock('@/hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({ isSupported: false }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: () => ({ data: { knowledgeBaseId: 'index' }, isPending: false }),
  useSearchSourceOverview: () => ({
    data: {
      providers: [
        { connectorType: 'slack', isSyncing: false },
        { connectorType: 'gmail', isSyncing: false },
      ],
    },
  }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({
    SourceCard: ({
      source,
      onSummarize,
    }: {
      source: { title: string; url: string }
      onSummarize?: (source: { title: string; url: string }) => void
    }) => (
      <div>
        <a href={source.url} data-source-link>
          {source.title}
        </a>
        <button type='button'>Copy link</button>
        {onSummarize && (
          <button type='button' onClick={() => onSummarize(source)}>
            Summarize
          </button>
        )}
      </div>
    ),
  })
)

import type {
  WorkspaceKnowledgeSearchBody,
  WorkspaceKnowledgeSearchData,
} from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { OrganizationSearch } from '@/app/o/[organizationId]/search/search'
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/knowledge-search-results'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

interface PendingSearch {
  body: WorkspaceKnowledgeSearchBody
  signal: AbortSignal
  resolve: (data: { data: WorkspaceKnowledgeSearchData }) => void
  reject: (error: Error) => void
}

let root: Root
let container: HTMLDivElement
let client: QueryClient
let requests: PendingSearch[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  mocks.userId = 'reader'
  requests = []
  mocks.request.mockImplementation(
    (_contract, input) =>
      new Promise((resolve, reject) => {
        requests.push({ ...input, resolve, reject })
      })
  )
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  client.clear()
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render({
  scope = { kind: 'organization', organizationId: 'organization' },
  query = 'launch',
  params = '',
  organizationPage = false,
  filters,
  topK,
}: {
  scope?: ResourceScope
  query?: string
  params?: string
  organizationPage?: boolean
  filters?: import('@/lib/api/contracts/knowledge').WorkspaceSearchFilters
  topK?: number
} = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams={params} onUrlUpdate={mocks.urlUpdate}>
          {organizationPage ? (
            <OrganizationSearch userId='reader' />
          ) : (
            <KnowledgeSearchResults
              scope={scope}
              query={query}
              filters={filters}
              topK={topK}
              onSummarize={mocks.summarize}
            />
          )}
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  })
}

function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label
  )
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}

async function click(label: string) {
  await act(async () => {
    button(label).focus()
    button(label).click()
    await vi.advanceTimersByTimeAsync(1)
  })
}

async function complete(
  index: number,
  { title = 'Release plan', partial = false, empty = false, count = 1 } = {}
) {
  await act(async () => {
    requests[index].resolve({
      data: {
        query: requests[index].body.query,
        results: empty
          ? []
          : Array.from({ length: count }, (_, n) => {
              const name = n === 0 ? title : `${title} ${n + 1}`
              return {
                documentId: name,
                knowledgeBaseId: 'index',
                knowledgeBaseName: 'Search index',
                documentName: name,
                sourceUrl: `https://example.com/release/${n}`,
                connectorType: requests[index].body.filters?.source ?? 'slack',
                sourceModifiedAt: null,
                author: null,
                content: 'launch details',
                chunkIndex: 0,
                similarity: 0.9,
              }
            }),
        retrieval: {
          status: partial ? 'partial' : 'complete',
          timedOutLegs: partial ? ['vector'] : [],
        },
      },
    })
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('search refinement with the real query cache and URL state', () => {
  it('does not restore cleared access data as a placeholder', async () => {
    await render()
    await complete(0)
    await act(async () => {
      void client.resetQueries({ queryKey: knowledgeKeys.searches() })
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.textContent).not.toContain('Release plan')
    await click('Gmail')
    expect(container.textContent).not.toContain('Release plan')
  })

  it('clears displayed placeholder data when access is reset during a refinement', async () => {
    await render()
    await complete(0)
    await click('Gmail')
    expect(container.textContent).toContain('Release plan')
    await act(async () => {
      void client.resetQueries({ queryKey: knowledgeKeys.searches() })
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.textContent).not.toContain('Release plan')
  })
})
