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
  urlUpdate: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
  }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({ useWorkspaceKnowledgeSearch: mocks.search }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: () => ({ data: { knowledgeBaseId: 'index-a' }, isPending: false }),
  useSearchSources: () => ({ data: [] }),
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/search-sources', () => ({
  isIndexing: () => false,
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
    return { data: [result], isPending: false, isFetching: false, isError: false }
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
  expect(mocks.search).toHaveBeenLastCalledWith(scope, query, {})
  expect(document.activeElement).toBe(searchInput())
}

describe('organization Search query navigation', () => {
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
