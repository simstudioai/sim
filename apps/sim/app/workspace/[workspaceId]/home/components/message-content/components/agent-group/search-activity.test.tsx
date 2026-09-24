/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MainAgentActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/main-agent-activity'
import { ToolCallItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

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
  vi.useRealTimers()
})
const render = (tools: ToolCallData[], liveToolId?: string) =>
  act(() =>
    root.render(
      <MainAgentActivity
        items={tools.map((data) => ({ type: 'tool', data }))}
        ToolCallComponent={ToolCallItem}
        renderItem={() => null}
        autoScrollActivity={false}
        liveToolId={liveToolId}
      />
    )
  )
const header = () => container.querySelector<HTMLElement>('[role="button"]')!
const headerText = () => container.querySelector('[role="status"]')!.textContent
const expand = () => act(() => header().click())

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

describe('search in shared tool activity', () => {
  it('omits raw queries from both the transcript and accessibility labels', () => {
    render([tool], tool.id)
    expect(headerText()).toBe('Searching documents')
    expect(header()).toBeNull()
    render([
      {
        ...completedSearch(tool.id, 'Launch review'),
        params: { ...tool.params, query: 'raw-provider-query-sentinel' },
      },
    ])
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expand()
    expect(container.querySelectorAll('a')).toHaveLength(3)
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Search results for step 1: Searched documents'
    )
    expect(container.innerHTML).not.toContain('in:launch review')
    expect(container.innerHTML).not.toContain('raw-provider-query-sentinel')
    expect(container.textContent).not.toContain('private-account')
    expect(container.textContent).not.toContain('opaque-cursor')
  })

  it('replaces a search with a document read in the same paced natural-language header', () => {
    vi.useFakeTimers()
    const search = { ...tool, activityDescription: 'Finding launch decisions' }
    render([search], search.id)
    const originalStatus = container.querySelector('[role="status"]')
    expect(headerText()).toBe('Finding launch decisions')
    const read: ToolCallData = {
      id: 'read',
      toolName: 'read_document',
      displayTitle: 'Reading document',
      activityDescription: 'Reading the launch plan',
      status: 'executing',
    }
    render([{ ...search, status: 'success' }, read], read.id)
    expect(container.querySelector('[role="status"]')).toBe(originalStatus)
    expect(headerText()).toBe('Finding launch decisions')
    act(() => vi.advanceTimersByTime(1000))
    expect(headerText()).toBe('Reading the launch plan')
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelectorAll('[class*="shimmer"]')).toHaveLength(1)
    render([
      { ...search, status: 'success' },
      { ...read, status: 'success' },
    ])
    expect(headerText()).toBe('Searched, read documents')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
  })

  it('retains the live search label between calls instead of returning to Thinking', () => {
    const search = {
      ...tool,
      status: 'success' as const,
      activityDescription: 'Finding launch decisions',
    }
    render([search], search.id)
    expect(headerText()).toBe('Finding launch decisions')
    render([search])
    expect(headerText()).toBe('Found launch decisions')
  })

  it('keeps every query snapshot, safe ranked links, and the manual disclosure choice as calls arrive', () => {
    const first = completedSearch('one', 'First query')
    render([first])
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expand()
    expect(container.querySelectorAll('a')).toHaveLength(3)
    expect(container.textContent).not.toContain('First query duplicate')
    expect(container.textContent).not.toContain('Unsafe result')
    expect(container.textContent).toContain('example.com')
    render([first, completedSearch('two', 'Second query')])
    expect(header().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('a')).toHaveLength(6)
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(2)
    expect(
      [...container.querySelectorAll('[role="region"]')].map((region) =>
        region.getAttribute('aria-label')
      )
    ).toEqual([
      'Search results for step 1: Searched documents',
      'Search results for step 2: Searched documents',
    ])
    act(() => header().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(header().getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a manually expanded query open through completion', () => {
    const first = completedSearch('first', 'Initial matches')
    render([first, tool], tool.id)
    expand()
    render([first, completedSearch(tool.id, 'Launch review')])
    expect(header().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('a')).toHaveLength(6)
  })

  it('never renders streamed query text', () => {
    render([{ ...tool, params: undefined, streamingArgs: '{"query":"launch review"' }])
    expect(headerText()).toBe('Searching documents')
    expect(header()).toBeNull()
    expect(container.innerHTML).not.toContain('launch review')
  })

  it('restores a completed search/read sequence as one collapsed activity', () => {
    render([
      completedSearch('one', 'First query'),
      { id: 'read', toolName: 'read_document', displayTitle: 'Read document', status: 'success' },
      completedSearch('two', 'Second query'),
    ])
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/First query|Second query|results/)
  })

  it('never previews failed output or adds search-only failure chrome', () => {
    render([{ ...completedSearch('one', 'First query'), status: 'error' }])
    expect(headerText()).toBe('Searching documents')
    expect(header()).toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/failed|no results/i)
    expect(container.innerHTML).not.toContain('--text-error')
  })

  it('replaces a failed search with the search that followed it', () => {
    const retry = completedSearch('two', 'Second query')
    render([retry])
    expand()
    const alone = { text: container.textContent, links: container.querySelectorAll('a').length }
    render([{ ...completedSearch('one', 'First query'), status: 'error' }, retry])
    expand()
    expect({ text: container.textContent, links: container.querySelectorAll('a').length }).toEqual(
      alone
    )
  })

  it('keeps a failed search that no later search retried', () => {
    const read: ToolCallData = {
      id: 'read',
      toolName: 'read_document',
      displayTitle: 'Reading document',
      activityDescription: 'Reading the launch plan',
      status: 'success',
    }
    render([read])
    expect(header()).toBeNull()
    render([{ ...completedSearch('one', 'First query'), status: 'error' }, read])
    expect(header()).not.toBeNull()
    expect(container.textContent).not.toMatch(/failed/i)
  })

  it('keeps the last search visible when every search failed', () => {
    render([
      { ...completedSearch('one', 'First query'), status: 'error' },
      { ...completedSearch('two', 'Second query'), status: 'error' },
    ])
    expect(headerText()).toBe('Searching documents')
    expect(container.textContent).not.toMatch(/failed/i)
  })

  it.each([
    { success: false, data: { results: [] } },
    {},
    {
      data: {
        results: [
          { citationId: 'unsafe', citationUrl: 'javascript:alert(1)', documentName: 'Unsafe' },
        ],
      },
    },
  ])('does not expose an empty disclosure for unusable saved output', (output) => {
    render([{ ...tool, status: 'success', result: { success: true, output } }])
    expect(header()).toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it.each([undefined, { status: 'complete', timedOutLegs: [] }])(
    'shows a complete or legacy empty result only in its history, without a header count',
    (retrieval) => {
      render([
        {
          ...tool,
          status: 'success',
          result: { success: true, output: { data: { results: [], retrieval } } },
        },
      ])
      expect(headerText()).toBe('Searched documents')
      expect(container.textContent).not.toContain('results')
      expand()
      expect(container.textContent).toContain('No results')
    }
  )

  it('does not claim no results or expose an empty disclosure when retrieval is partial', () => {
    render([
      {
        ...tool,
        status: 'success',
        result: {
          success: true,
          output: {
            data: { results: [], retrieval: { status: 'partial', timedOutLegs: ['vector'] } },
          },
        },
      },
    ])
    expect(headerText()).toBe('Searched documents')
    expect(header()).toBeNull()
    expect(container.textContent).not.toContain('No results')
  })

  it('preserves available source matches when retrieval is partial', () => {
    const search = completedSearch('partial', 'Available matches')
    const output = search.result!.output as { data: Record<string, unknown> }
    output.data.retrieval = { status: 'partial', timedOutLegs: ['vector'] }
    render([search])
    expand()
    expect(container.querySelectorAll('a')).toHaveLength(3)
    expect(container.textContent).not.toContain('No results')
  })

  it.each([
    ['executing', 'Searching launch review notes'],
    ['success', 'Searched launch review notes'],
    ['error', 'Searching launch review notes'],
    ['rejected', 'Searching launch review notes'],
    ['cancelled', 'Stopped searching launch review notes'],
    ['interrupted', 'Stopped searching launch review notes'],
    ['skipped', 'Skipped searching launch review notes'],
  ] as const)('uses ordinary tool wording for %s', (status, expected) => {
    render([{ ...tool, status, activityDescription: 'Searching launch review notes' }])
    expect(headerText()).toBe(expected)
  })

  it('falls back to a document icon if a source favicon fails', () => {
    render([completedSearch('one', 'First query')])
    expand()
    const link = container.querySelector('a')!
    act(() => link.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(link.querySelector('img')).toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()
  })
})
