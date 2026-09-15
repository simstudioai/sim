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
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
}: {
  scope?: ResourceScope
  query?: string
  params?: string
} = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams={params} onUrlUpdate={mocks.urlUpdate}>
          <KnowledgeSearchResults scope={scope} query={query} onSummarize={mocks.summarize} />
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
  { title = 'Release plan', partial = false, empty = false } = {}
) {
  await act(async () => {
    requests[index].resolve({
      data: {
        query: requests[index].body.query,
        results: empty
          ? []
          : [
              {
                documentId: title,
                knowledgeBaseId: 'index',
                knowledgeBaseName: 'Search index',
                documentName: title,
                sourceUrl: 'https://example.com/release',
                connectorType: requests[index].body.filters?.source ?? 'slack',
                sourceModifiedAt: null,
                author: null,
                content: 'launch details',
                chunkIndex: 0,
                similarity: 0.9,
              },
            ],
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
  it('replaces filter URL state while preserving unrelated parameters', async () => {
    await render({ params: '?q=launch&panel=details' })
    await click('Gmail')
    await click('Past week')
    expect(mocks.urlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryString: '?q=launch&panel=details&source=gmail&updated=7d',
        options: expect.objectContaining({ history: 'replace' }),
      })
    )
    await click('All sources')
    await click('Any time')
    expect(mocks.urlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ queryString: '?q=launch&panel=details' })
    )
  })

  it('keeps controls and focus while retaining only the preceding refinement results', async () => {
    await render()
    expect(button('Gmail')).toBeDefined()
    expect(container.textContent).toContain('Searching…')
    await complete(0)
    const gmail = button('Gmail')
    await click('Gmail')
    expect(button('Gmail')).toBe(gmail)
    expect(document.activeElement).toBe(gmail)
    expect(gmail.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('Updating results…')
    expect(container.textContent).toContain('Release plan')
    expect(container.textContent).not.toContain('Summarize')
    expect(requests[1].body.filters).toMatchObject({ source: 'gmail' })
    await complete(1, { title: 'Email plan' })
    expect(document.activeElement).toBe(gmail)
    expect(container.textContent).not.toContain('Release plan')
    await click('Summarize')
    expect(mocks.summarize).toHaveBeenCalledWith(expect.any(String), {
      source: 'gmail',
      documentIds: ['Email plan'],
    })
  })

  it('cancels an abandoned refinement and reuses a fresh cached result', async () => {
    await render()
    await complete(0)
    await click('Gmail')
    await click('All sources')
    expect(requests).toHaveLength(2)
    expect(requests[1].signal.aborted).toBe(true)
    expect(container.textContent).toContain('Release plan')
    expect(container.textContent).not.toContain('Updating results…')
    await complete(1, { title: 'Abandoned result' })
    expect(container.textContent).not.toContain('Abandoned result')
  })

  it('keeps one rolling cutoff across source and date refinements, then resets for a new query', async () => {
    await render({ params: '?updated=7d' })
    const cutoff = requests[0].body.filters?.modifiedAfter
    expect(cutoff).toBe('2026-01-08T12:00:00.000Z')
    await complete(0)
    vi.setSystemTime(new Date('2026-01-15T12:00:20Z'))
    await click('Gmail')
    expect(requests[1].body.filters?.modifiedAfter).toBe(cutoff)
    await click('Past month')
    expect(requests[2].body.filters?.modifiedAfter).toBe('2025-12-16T12:00:00.000Z')
    await click('Past week')
    expect(requests[3].body.filters?.modifiedAfter).toBe(cutoff)
    vi.setSystemTime(new Date('2026-01-15T12:00:30Z'))
    await render({ query: 'another question', params: '?updated=7d' })
    expect(requests.at(-1)?.body.filters?.modifiedAfter).toBe('2026-01-08T12:00:30.000Z')
  })

  it.each(['query', 'organization', 'workspace', 'reader'])(
    'clears prior results when the %s changes',
    async (change) => {
      await render()
      await complete(0)
      if (change === 'reader') mocks.userId = 'another-reader'
      await render({
        query: change === 'query' ? 'another question' : 'launch',
        scope:
          change === 'organization'
            ? { kind: 'organization', organizationId: 'another-org' }
            : change === 'workspace'
              ? { kind: 'workspace', workspaceId: 'another-workspace' }
              : { kind: 'organization', organizationId: 'organization' },
      })
      expect(container.textContent).not.toContain('Release plan')
      expect(container.textContent).toContain('Searching…')
      expect(requests).toHaveLength(2)
    }
  )

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

  it('does not retain invalidated results during a refinement', async () => {
    await render()
    await complete(0)
    await act(async () => {
      await client.invalidateQueries({ queryKey: knowledgeKeys.searches(), refetchType: 'none' })
    })
    await click('Gmail')
    expect(container.textContent).not.toContain('Release plan')
  })

  it.each([true, false])(
    'keeps filters and useful matches for partial results, then retries (empty=%s)',
    async (empty) => {
      await render()
      await complete(0, { partial: true, empty })
      expect(container.textContent).toContain(
        empty ? 'Search didn’t finish.' : 'some results may be missing.'
      )
      expect(container.textContent).not.toContain('Search found no results.')
      const gmail = button('Gmail')
      await click('Try again')
      expect(button('Retrying…').disabled).toBe(true)
      expect(button('Gmail')).toBe(gmail)
      await complete(1, { empty: true })
      expect(container.textContent).toContain('Search found no results.')
      expect(container.textContent).not.toContain('Try again')
    }
  )

  it('preserves filter focus and permits recovery after a failed refinement', async () => {
    await render()
    await complete(0)
    const gmail = button('Gmail')
    await click('Gmail')
    await act(async () => {
      requests[1].reject(new Error('Search failed'))
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(document.activeElement).toBe(gmail)
    expect(container.textContent).toContain('Search couldn’t run.')
    expect(container.textContent).not.toContain('Release plan')
    await click('All sources')
    expect(container.textContent).toContain('Release plan')
  })

  it('does not redirect arrow keys from row actions to the first result', async () => {
    await render()
    await complete(0)
    const copy = button('Copy link')
    copy.focus()
    act(() => copy.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(copy)
  })
})
