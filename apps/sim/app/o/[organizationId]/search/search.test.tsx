/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import type { useSpeechToText } from '@/hooks/use-speech-to-text'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  assistant: vi.fn(),
  urlUpdate: vi.fn(),
  push: vi.fn(),
  pathname: vi.fn(),
  speech: vi.fn<typeof useSpeechToText>(),
  toggleListening: vi.fn(),
}))

vi.mock('@/app/o/[organizationId]/home/organization-home', () => ({
  OrganizationHome: mocks.assistant,
}))
vi.mock('@/hooks/use-speech-to-text', () => ({ useSpeechToText: mocks.speech }))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: mocks.pathname,
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'organization-a', name: 'Acme' },
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
    SourceCard: ({ source }: { source: SourceTagData }) => (
      <a href={source.url} data-source-link>
        {source.title}
      </a>
    ),
  })
)

import { OrganizationSearch } from '@/app/o/[organizationId]/search/search'

const scope: ResourceScope = { kind: 'organization', organizationId: 'organization-a' }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname.mockReturnValue('/o/organization-a/search')
  mocks.assistant.mockReturnValue(<div>Search Assistant composer</div>)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  mocks.speech.mockReturnValue({
    isSupported: true,
    isListening: false,
    audioLevelsRef: { current: new Float32Array(5) },
    toggleListening: mocks.toggleListening,
    resetTranscript: vi.fn(),
  })
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
        <OrganizationSearch />
      </NuqsTestingAdapter>
    )
  )
}

function searchInput() {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search your sources"]')
  if (!input) throw new Error('Missing Search input')
  return input
}

async function editDraft(value: string) {
  await act(async () => {
    const input = searchInput()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function expectVisibleQuery(query: string) {
  expect(searchInput().value).toBe(query)
  expect(container.querySelector('a[data-source-link]')?.textContent).toBe(`${query} launch plan`)
  expect(mocks.search).toHaveBeenLastCalledWith(scope, query, {}, 20)
  expect(document.activeElement).toBe(searchInput())
}

describe('organization Search query navigation', () => {
  it.each(['', '?q=Orion'])(
    'dictates into the draft without searching until submit (%s)',
    async (params) => {
      await render(params)
      await editDraft('Find')
      const searchCalls = mocks.search.mock.calls.length
      const mic = container.querySelector<HTMLButtonElement>('button[aria-label="Voice input"]')!
      expect(mic.nextElementSibling?.getAttribute('aria-label')).toBe('Search')
      await act(async () => mic.click())
      expect(mocks.toggleListening).toHaveBeenCalledOnce()
      const speech = mocks.speech.mock.calls.at(-1)![0]
      expect(speech.organizationId).toBe('organization-a')
      await act(async () => speech.onTranscript('release'))
      await act(async () => speech.onTranscript('release notes'))
      expect(searchInput().value).toBe('Find release notes')
      expect(mocks.search).toHaveBeenCalledTimes(searchCalls)
      expect(mocks.urlUpdate).not.toHaveBeenCalled()
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click()
      })
      expectVisibleQuery('Find release notes')
    }
  )

  it('replaces the field draft and results when the committed URL query changes without remounting the page', async () => {
    await render('?q=Orion')
    expectVisibleQuery('Orion')
    await editDraft('Unsubmitted draft')

    await render('?q=Vega')
    expectVisibleQuery('Vega')
    expect(container.textContent).not.toContain('Orion launch plan')

    await render('?q=Orion')
    expectVisibleQuery('Orion')
    expect(container.textContent).not.toContain('Vega launch plan')
    expect(mocks.urlUpdate).not.toHaveBeenCalled()
  })

  it.each(['Enter', 'button'] as const)(
    'keeps the draft out of Search until %s commits it and restores input focus afterward',
    async (submit) => {
      await render('?q=Orion')
      const callsBeforeEditing = mocks.search.mock.calls.length
      await editDraft('  Vega  ')
      expect(searchInput().value).toBe('  Vega  ')
      expect(container.querySelector('a[data-source-link]')?.textContent).toBe('Orion launch plan')
      expect(mocks.search).toHaveBeenCalledTimes(callsBeforeEditing)
      expect(mocks.urlUpdate).not.toHaveBeenCalled()

      await act(async () => {
        if (submit === 'Enter') {
          searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        } else {
          const button = container.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!
          button.focus()
          button.click()
        }
      })
      expectVisibleQuery('Vega')
      await vi.waitFor(() =>
        expect(mocks.urlUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ queryString: '?q=Vega' })
        )
      )
    }
  )

  it('waits for the first submission before mounting results and keeps focus as the field docks', async () => {
    await render()
    expect(document.activeElement).toBe(searchInput())
    await editDraft('Orion')
    expect(mocks.search).not.toHaveBeenCalled()
    expect(container.querySelector('a[data-source-link]')).toBeNull()
    await act(async () =>
      searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expectVisibleQuery('Orion')
  })
})

describe('organization Search header placement', () => {
  it('tracks result scroll edges after submitting from the centered layout', async () => {
    await render()
    await editDraft('Orion')
    await act(async () =>
      searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    const results = container.querySelector('[aria-label="Search results"]')!
    const scroller = results.closest<HTMLDivElement>('.overflow-y-auto')!
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 400 },
    })
    await act(async () => {
      scroller.scrollTop = 100
      scroller.dispatchEvent(new Event('scroll'))
    })
    expect(scroller.getAttribute('data-scroll-fade-top')).toBe('true')
    expect(scroller.getAttribute('data-scroll-fade-bottom')).toBe('true')
    await act(async () => {
      scroller.scrollTop = 600
      scroller.dispatchEvent(new Event('scroll'))
    })
    expect(scroller.getAttribute('data-scroll-fade-bottom')).toBeNull()
  })

  it.each([
    ['pending', { isPending: true, isFetching: true }],
    ['failed', { isError: true, isPending: false }],
    ['empty', { data: { results: [], retrieval: { status: 'complete', timedOutLegs: [] } } }],
    [
      'timed out',
      { data: { results: [], retrieval: { status: 'partial', timedOutLegs: ['vector'] } } },
    ],
  ])('keeps a submitted %s search at the top', async (_state, response) => {
    mocks.search.mockReturnValue(response)
    await render('?q=Orion')
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('[aria-label="Search results"]')).toBeNull()
    expect(document.activeElement).toBe(searchInput())
  })

  it('moves to the top on submit and reveals filters after results without losing a draft', async () => {
    const completed = mocks.search(scope, 'Orion')
    mocks.search.mockReturnValue({ isPending: true, isFetching: true })
    await render()
    expect(container.querySelector('h1')?.textContent).toBe('Search Acme')
    await editDraft('Orion')
    await act(async () =>
      searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(container.querySelector('h1')).toBeNull()
    expect(container.textContent).toContain('Searching…')
    expect(container.querySelector('[aria-label="Search filters"]')).toBeNull()
    const input = searchInput()
    await editDraft('Unsubmitted draft')
    mocks.search.mockReturnValue(completed)
    await render('?q=Orion')
    expect(container.querySelector('h1')).toBeNull()
    expect(searchInput()).toBe(input)
    expect(input.value).toBe('Unsubmitted draft')
    expect(document.activeElement).toBe(input)
    const filters = container.querySelector('[aria-label="Search filters"]')
    expect(filters).not.toBeNull()

    mocks.search.mockReturnValue({
      data: { results: [], retrieval: { status: 'complete', timedOutLegs: [] } },
    })
    await render('?q=Orion')
    expect(container.querySelector('h1')).toBeNull()
    expect(searchInput()).toBe(input)
    expect(container.querySelector('[aria-label="Search filters"]')).toBe(filters)

    mocks.search.mockReturnValue({ isPending: true, isFetching: true })
    await render('?q=Vega')
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('[aria-label="Search filters"]')).toBeNull()
    expect(searchInput().value).toBe('Vega')

    await render()
    expect(container.querySelector('h1')?.textContent).toBe('Search Acme')
    expect(container.querySelector('[aria-label="Search filters"]')).toBeNull()
  })
})

describe('organization Search intent toggle', () => {
  it('keeps the live Assistant mounted when the first message replaces the URL with a chat route', async () => {
    await render('?view=assistant')
    const composer = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent === 'Search Assistant composer' && node.childElementCount === 0
    )
    expect(composer).toBeDefined()
    mocks.pathname.mockReturnValue('/o/organization-a/chat/new-chat')
    await render('')
    expect(container.contains(composer!)).toBe(true)
    expect(container.querySelector('input[aria-label="Search your sources"]')).toBeNull()
    expect(mocks.assistant).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestMode: 'assistant', chatId: undefined }),
      undefined
    )
    expect(
      container.querySelector('[role="radio"][value="assistant"]')?.getAttribute('aria-checked')
    ).toBe('true')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="radio"][value="results"]')!.click()
    )
    expect(mocks.push).toHaveBeenCalledWith('/o/organization-a/search?')
  })

  it('does not treat another organization chat path as this organization Assistant', async () => {
    mocks.pathname.mockReturnValue('/o/organization-other/chat/chat')
    await render('')
    expect(searchInput()).toBeDefined()
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
  it('preserves committed query and filters without submitting an Assistant turn', async () => {
    await render('?q=Orion&source=slack&updated=7d')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="radio"][value="assistant"]')!.click()
    )
    expect(mocks.assistant).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestMode: 'assistant' }),
      undefined
    )
    expect(container.textContent).toContain('Search Assistant composer')
    await vi.waitFor(() =>
      expect(mocks.urlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ queryString: '?q=Orion&source=slack&updated=7d&view=assistant' })
      )
    )
    expect(mocks.push).not.toHaveBeenCalled()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="radio"][value="results"]')!.click()
    )
    expect(searchInput().value).toBe('Orion')
    expect(mocks.search).toHaveBeenLastCalledWith(
      scope,
      'Orion',
      expect.objectContaining({ source: 'slack' })
    )
  })
  it('reopens the Assistant URL without running the raw query', async () => {
    await render('?q=Orion&view=assistant')
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.assistant).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestMode: 'assistant' }),
      undefined
    )
    expect(mocks.urlUpdate).not.toHaveBeenCalled()
  })
})
