/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MainAgentActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/main-agent-activity'
import {
  isSearchActivityTool,
  SearchActivity,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/search-activity'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-viewport',
  () => ({
    ActivityViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group',
  () => ({
    ToolActivityGroup: ({ tools }: { tools: ToolCallData[] }) => (
      <div>{tools.map((tool) => tool.displayTitle).join(', ')}</div>
    ),
  })
)

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const render = (element: ReactNode) => act(() => root.render(element))
const header = () => container.querySelector<HTMLElement>('[role="button"]')!
const tool: ToolCallData = {
  id: 'search-1',
  toolName: 'search_workspace',
  displayTitle: 'Searching documents',
  status: 'executing',
  params: {
    query: 'Launch review',
    nativeQueries: [
      {
        provider: 'slack',
        query: 'in:launch review',
        accountId: 'private-account',
        cursor: 'opaque-cursor',
      },
    ],
  },
}

describe('inline search activity', () => {
  it('keeps query history visible through completion without exposing raw arguments', () => {
    render(<SearchActivity tools={[tool]} />)
    expect(container.textContent).toContain('Launch review')
    expect(container.textContent).toContain('in:launch review')
    expect(container.textContent).not.toContain('private-account')
    expect(container.textContent).not.toContain('opaque-cursor')
    render(
      <SearchActivity
        tools={[{ ...completedSearch('search-1', 'Launch review'), params: tool.params }]}
      />
    )
    expect(header().getAttribute('aria-expanded')).toBe('false')
    act(() => header().click())
    expect(header().getAttribute('aria-expanded')).toBe('true')
  })

  it('renders a completed query field from partial streamed arguments and retains stopped status', () => {
    const streamed = { ...tool, params: undefined, streamingArgs: '{"query":"launch review"' }
    render(<SearchActivity tools={[streamed]} />)
    expect(container.textContent).toContain('launch review')
    render(<SearchActivity tools={[{ ...streamed, status: 'cancelled' }]} />)
    expect(container.textContent).toBe('launch review · stopped')
    expect(container.textContent).not.toContain('Searched sources')
  })

  it.each([
    ['preparing', { ...tool, params: undefined, streamingArgs: '{"que' }, 'Preparing query'],
    ['running', tool, 'Launch review'],
    [
      'checking sources',
      { ...tool, toolName: 'search_sources', params: { action: 'list' } },
      'Checking connected sources',
    ],
    ['done', { ...tool, status: 'success' }, 'Launch review'],
    ['failed', { ...tool, status: 'error' }, 'Launch review'],
    [
      'checked sources',
      { ...tool, toolName: 'search_sources', status: 'success', params: { action: 'list' } },
      'Checked connected sources',
    ],
    [
      'failed sources check',
      { ...tool, toolName: 'search_sources', status: 'error', params: { action: 'list' } },
      'Checked connected sources',
    ],
  ] as const)(
    'labels a %s search and leaves it static unless its lane names it live',
    (_state, call, label) => {
      render(<SearchActivity tools={[call as ToolCallData]} />)
      const status = container.querySelector('[role="status"]')
      expect(status?.textContent).toContain(label)
      expect(status?.querySelector('[class*="shimmer"]')).toBeNull()
    }
  )

  it('shimmers only the row holding the lane live call', () => {
    const first = { ...tool, id: 'first', params: { query: 'First query' } }
    const second = { ...tool, id: 'second', params: { query: 'Second query' } }
    const liveLabels = () =>
      [...container.querySelectorAll('[role="status"]')]
        .filter((row) => row.querySelector('[class*="shimmer"]'))
        .map((row) => row.textContent)
    render(<SearchActivity tools={[first, second]} liveToolId='second' />)
    expect(liveLabels()).toEqual(['Second query'])
    render(<SearchActivity tools={[first, second]} liveToolId='first' />)
    expect(liveLabels()).toEqual(['First query'])
    render(<SearchActivity tools={[first, second]} />)
    expect(liveLabels()).toEqual([])
  })

  it('keeps source setup and approval in the interactive tool renderer', () => {
    expect(
      isSearchActivityTool({ ...tool, toolName: 'search_sources', params: { action: 'list' } })
    ).toBe(true)
    expect(
      isSearchActivityTool({ ...tool, toolName: 'search_sources', params: { action: 'approve' } })
    ).toBe(false)
    expect(
      isSearchActivityTool({ ...tool, toolName: 'search_sources', params: { action: 'setup' } })
    ).toBe(false)
  })

  it('preserves chronological search, other tool, and answer sections', () => {
    render(
      <MainAgentActivity
        items={[
          { type: 'tool', data: tool },
          {
            type: 'tool',
            data: { ...tool, id: 'read', toolName: 'read_document', displayTitle: 'Read document' },
          },
          { type: 'text', content: 'Answer' },
        ]}
        ToolCallComponent={() => null}
        renderItem={(item) => (item.type === 'text' ? item.content : null)}
        autoScrollActivity={false}
        isActive={false}
      />
    )
    expect(container.textContent).toMatch(/Launch review.*Read document.*Answer/)
  })
})

function completedSearch(id: string, title: string): ToolCallData {
  return {
    ...tool,
    id,
    status: 'success',
    params: { query: title },
    result: {
      success: true,
      output: {
        data: {
          results: [
            {
              citationId: `${id}:1`,
              citationUrl: `https://example.com/${id}/1`,
              documentName: `${title} first`,
              content: 'Top ranked passage',
            },
            {
              citationId: `${id}:2`,
              citationUrl: `https://example.com/${id}/2`,
              documentName: `${title} second`,
            },
            {
              citationId: `${id}:3`,
              citationUrl: `https://example.com/${id}/3`,
              documentName: `${title} third`,
            },
            {
              citationId: `${id}:4`,
              citationUrl: `https://example.com/${id}/1`,
              documentName: `${title} duplicate`,
              content: 'Lower ranked passage',
            },
            {
              citationId: `${id}:unsafe`,
              citationUrl: 'javascript:alert(1)',
              documentName: 'Unsafe result',
            },
          ],
        },
      },
    },
  }
}

it('keeps all ranked matches in each query and preserves disclosure state when later queries arrive', () => {
  const first = completedSearch('one', 'First query')
  render(<SearchActivity tools={[first]} />)
  expect(header().getAttribute('aria-expanded')).toBe('false')
  act(() => header().click())
  expect(header().getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelectorAll('a')).toHaveLength(3)
  expect(container.textContent).toContain('First query first')
  expect(container.textContent).not.toContain('First query duplicate')
  expect(container.textContent).not.toContain('Unsafe result')
  expect(container.textContent).toContain('example.com')
  render(<SearchActivity tools={[first, completedSearch('two', 'Second query')]} />)
  expect(header().getAttribute('aria-expanded')).toBe('true')
  const headers = container.querySelectorAll<HTMLElement>('[role="button"]')
  expect(headers[1].getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelectorAll('a')).toHaveLength(3)
  act(() => headers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(container.querySelectorAll('a')).toHaveLength(6)
  expect(container.querySelectorAll('[role="region"]')).toHaveLength(2)
})

it('falls back to a document icon when a source favicon is unavailable', () => {
  render(<SearchActivity tools={[completedSearch('one', 'First query')]} />)
  act(() => header().click())
  const firstLink = container.querySelector('a')!
  expect(firstLink.querySelector('img')).not.toBeNull()
  act(() => firstLink.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(firstLink.querySelector('img')).toBeNull()
  expect(firstLink.querySelector('svg')).not.toBeNull()
})

it('distinguishes empty search results from interrupted calls and never previews failed output', () => {
  render(<SearchActivity tools={[{ ...completedSearch('one', 'First query'), status: 'error' }]} />)
  expect(container.querySelectorAll('a')).toHaveLength(0)
  expect(container.textContent).toBe('First query')
  expect(container.querySelector('[role="button"]')).toBeNull()
  render(
    <SearchActivity
      tools={[
        {
          ...tool,
          status: 'success',
          result: { success: true, output: { data: { results: [] } } },
        },
      ]}
    />
  )
  expect(container.textContent).toBe('Launch review · in:launch review · no results')
})

describe('described search rows', () => {
  const described: ToolCallData = { ...tool, activityDescription: 'Searching launch review notes' }
  const headerText = () => container.querySelector('[role="status"]')!.textContent
  const outcomeSuffix = () => container.querySelector('[role="status"] + span')

  it.each([
    ['executing', 'Searching launch review notes', undefined],
    ['success', 'Searched launch review notes', ' · 3 results'],
    ['error', 'Searching launch review notes', undefined],
    ['rejected', 'Searching launch review notes', ' · declined'],
    ['cancelled', 'Stopped searching launch review notes', undefined],
    ['interrupted', 'Stopped searching launch review notes', undefined],
    ['skipped', 'Skipped searching launch review notes', undefined],
  ] as const)('titles a %s call with the shared status wording', (status, title, suffix) => {
    render(
      <SearchActivity
        tools={[
          {
            ...completedSearch('one', 'Launch review'),
            params: tool.params,
            activityDescription: described.activityDescription,
            status,
          },
        ]}
      />
    )
    expect(headerText()).toBe(title)
    expect(outcomeSuffix()?.textContent).toBe(suffix)
  })

  it('reads in progress only while running, and never on a finished call', () => {
    render(<SearchActivity tools={[described]} liveToolId={described.id} />)
    expect(headerText()).toBe('Searching launch review notes')
    expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
    render(<SearchActivity tools={[{ ...described, status: 'success' }]} />)
    expect(headerText()).toBe('Searched launch review notes')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
  })

  it('moves the raw query into one truncated line at the top of the body', () => {
    render(<SearchActivity tools={[described]} />)
    expect(header().getAttribute('aria-expanded')).toBe('true')
    const body = container.querySelector(`#${CSS.escape(header().getAttribute('aria-controls')!)}`)!
    const queryLine = body.querySelector('.text-caption')!
    expect(queryLine.textContent).toBe('Launch review · in:launch review')
    expect(queryLine.className).toContain('whitespace-nowrap')
    expect(queryLine.className).toContain('overflow-hidden')
    expect(headerText()).not.toContain('Launch review')
  })

  it('shows the query only once when there is no description', () => {
    render(<SearchActivity tools={[completedSearch('one', 'Launch review')]} />)
    act(() => header().click())
    expect(container.textContent?.match(/Launch review(?! first| second| third)/g)).toHaveLength(1)
  })

  it('opens while running, closes on completion, and keeps a manual choice either way', () => {
    render(<SearchActivity tools={[described]} />)
    expect(header().getAttribute('aria-expanded')).toBe('true')
    render(<SearchActivity tools={[{ ...described, status: 'success' }]} />)
    expect(header().getAttribute('aria-expanded')).toBe('false')

    act(() => root.unmount())
    root = createRoot(container)
    render(<SearchActivity tools={[described]} />)
    act(() => header().click())
    expect(header().getAttribute('aria-expanded')).toBe('false')
    render(<SearchActivity tools={[{ ...described, status: 'success' }]} />)
    expect(header().getAttribute('aria-expanded')).toBe('false')
    act(() => header().click())
    expect(header().getAttribute('aria-expanded')).toBe('true')

    act(() => root.unmount())
    root = createRoot(container)
    render(<SearchActivity tools={[described]} />)
    act(() => header().click())
    act(() => header().click())
    render(<SearchActivity tools={[{ ...described, status: 'success' }]} />)
    expect(header().getAttribute('aria-expanded')).toBe('true')
  })

  it('renders a reloaded message with every finished search collapsed', () => {
    render(
      <SearchActivity
        tools={[
          { ...completedSearch('one', 'First query'), activityDescription: 'Searching specs' },
          completedSearch('two', 'Second query'),
          { ...described, id: 'three', status: 'error' },
        ]}
      />
    )
    const headers = [...container.querySelectorAll<HTMLElement>('[role="button"]')]
    expect(headers.map((row) => row.getAttribute('aria-expanded'))).toEqual([
      'false',
      'false',
      'false',
    ])
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('keeps a failed search silent: static neutral title, no failure text or error styling', () => {
    render(<SearchActivity tools={[{ ...tool, status: 'error' }]} />)
    expect(container.querySelector('[role="button"]')).toBeNull()
    expect(container.textContent).toBe('Launch review · in:launch review')
    render(
      <SearchActivity tools={[{ ...completedSearch('one', 'x'), ...described, status: 'error' }]} />
    )
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(headerText()).toBe('Searching launch review notes')
    expect(outcomeSuffix()).toBeNull()
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
    act(() => header().click())
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toBe(
      'Searching launch review notesLaunch review · in:launch review'
    )
    expect(container.textContent).not.toMatch(/fail/i)
    expect(container.innerHTML).not.toContain('--text-error')
  })

  it('keeps user-initiated and empty outcomes as muted suffixes', () => {
    render(<SearchActivity tools={[{ ...described, status: 'rejected' }]} />)
    expect(outcomeSuffix()?.textContent).toBe(' · declined')
    expect(outcomeSuffix()?.className).toContain('text-[var(--text-tertiary)]')
    render(<SearchActivity tools={[{ ...tool, status: 'skipped' }]} />)
    expect(outcomeSuffix()?.textContent).toBe(' · skipped')
    render(<SearchActivity tools={[completedSearch('one', 'First query')]} />)
    expect(outcomeSuffix()?.textContent).toBe(' · 3 results')
    expect(container.innerHTML).not.toContain('--text-error')
  })

  it('lays results out in dense rows with a matching bounded list', () => {
    render(<SearchActivity tools={[completedSearch('one', 'First query')]} />)
    act(() => header().click())
    expect(container.querySelector('[role="region"]')!.className).toContain('max-h-[152px]')
    for (const link of container.querySelectorAll('a')) {
      expect(link.className).toContain('h-8')
      expect(link.className).not.toContain('h-10')
    }
  })
})
