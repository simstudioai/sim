/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageContent } from '@/app/workspace/[workspaceId]/home/components/message-content/message-content'
import type { ContentBlock, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}))

function start(name: string, parentSpanId = 'main'): ContentBlock {
  return { type: 'subagent', content: name, spanId: name, parentSpanId, timestamp: 1 }
}

function tool(spanId: string, status: ToolCallStatus = 'executing'): ContentBlock {
  return {
    type: 'tool_call',
    spanId,
    toolCall: {
      id: `${spanId}-read`,
      name: 'read',
      calledBy: spanId,
      status,
      activityDescription: `Reading ${spanId} notes`,
    },
    timestamp: 2,
  }
}

describe('MessageContent shared thinking indicator', () => {
  let queryClient: QueryClient
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    queryClient = new QueryClient()
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    queryClient.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const render = (blocks: ContentBlock[], isStreaming = true) =>
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MessageContent blocks={blocks} fallbackContent='' isStreaming={isStreaming} isLast />
        </QueryClientProvider>
      )
    })
  const thinking = () => container.querySelectorAll('[aria-hidden="false"] svg')
  const groups = () => container.querySelectorAll('[data-agent-group]')

  it.each([undefined, 'main'])(
    'keeps an open main activity in progress through gaps without thinking (spanId=%s)',
    (spanId) => {
      const inspect = {
        id: 'inspect',
        title: 'Inspecting workspace resources',
        completedTitle: 'Inspected workspace resources',
      }
      const call = (
        id: string,
        name: string,
        displayTitle: string,
        status: ToolCallStatus,
        activity: Record<string, string> = inspect
      ): ContentBlock => ({
        type: 'tool_call',
        spanId,
        toolCall: { id, name, status, displayTitle, params: { activity } },
      })
      const header = () =>
        container.querySelector('[data-agent-group]:last-of-type [role="status"]')
      const shimmering = () => Boolean(header()?.querySelector('[class*="shimmer"]'))
      const headers: string[] = []
      const step = (blocks: ContentBlock[], isStreaming = true) => {
        render(blocks, isStreaming)
        act(() => vi.advanceTimersByTime(1_500))
        headers.push(header()?.textContent ?? '')
      }

      render([])
      expect(thinking()).toHaveLength(1)

      const list = call('list', 'cli_tables_list', 'Listing tables', 'executing')
      step([list])
      expect(thinking()).toHaveLength(0)
      expect(shimmering()).toBe(true)

      const listed = { ...list, toolCall: { ...list.toolCall!, status: 'success' as const } }
      step([listed])
      step([listed, { type: 'thinking', content: 'Checking the result.', timestamp: 3 }])
      expect(thinking()).toHaveLength(0)
      expect(shimmering()).toBe(true)

      const get = call('get', 'cli_tables_get', 'Reading table Invoices', 'executing')
      step([listed, get])
      expect(thinking()).toHaveLength(0)
      const got = { ...get, toolCall: { ...get.toolCall!, status: 'success' as const } }
      step([listed, got])
      expect(thinking()).toHaveLength(0)
      expect(shimmering()).toBe(true)
      expect(headers).toEqual([
        'Listing tables',
        'Listing tables',
        'Listing tables',
        'Reading table Invoices',
        'Reading table Invoices',
      ])

      const draft = {
        id: 'draft',
        title: 'Drafting the summary',
        completedTitle: 'Drafted the summary',
      }
      step([listed, got, call('write', 'cli_files_create', 'Creating file', 'executing', draft)])
      const groupHeaders = () =>
        [...container.querySelectorAll('[data-agent-group]')].map(
          (group) => group.querySelector('[role="status"]')?.textContent
        )
      expect(groupHeaders()).toEqual(['Inspected workspace resources', 'Creating file'])
      expect(thinking()).toHaveLength(0)

      const written = call('write', 'cli_files_create', 'Creating file', 'success', draft)
      step([listed, got, written])
      expect(groupHeaders()).toEqual(['Inspected workspace resources', 'Creating file'])
      expect(thinking()).toHaveLength(0)

      render([listed, got, written], false)
      expect(groupHeaders()).toEqual(['Inspected workspace resources', 'Created file'])
      expect(shimmering()).toBe(false)
      expect(thinking()).toHaveLength(0)
    }
  )

  it('returns the turn indicator once prose closes the main activity', () => {
    const read: ContentBlock = {
      type: 'tool_call',
      toolCall: {
        id: 'docs',
        name: 'search_docs',
        status: 'success',
        displayTitle: 'Searching Sim docs',
      },
    }
    render([read])
    act(() => vi.advanceTimersByTime(1_500))
    expect(thinking()).toHaveLength(0)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Searching Sim docs')

    render([read, { type: 'text', content: 'Found the docs.', timestamp: 3 }])
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Searched Sim docs')
    act(() => vi.advanceTimersByTime(3_000))
    expect(thinking()).toHaveLength(1)
  })

  it.each([
    ['executing', true],
    ['success', true],
  ] as const)(
    'shows exactly one live indicator around a %s main search',
    (status, searchIsLive) => {
      render([
        {
          type: 'tool_call',
          toolCall: {
            id: 'search',
            name: 'search_workspace',
            status,
            displayTitle: 'Searching documents',
            params: { query: 'launch review' },
          },
        },
      ])
      act(() => vi.advanceTimersByTime(1_500))
      const shimmers = container.querySelectorAll('[data-agent-group] [class*="shimmer"]')
      expect(shimmers).toHaveLength(searchIsLive ? 1 : 0)
      expect(thinking()).toHaveLength(searchIsLive ? 0 : 1)
    }
  )

  it.each([
    ['success then error', ['success', 'error'], false],
    ['success then stopped', ['success', 'cancelled'], false],
    ['error then success', ['error', 'success'], true],
    ['success then running', ['success', 'executing'], true],
  ] as const)('decides the open group from its latest call: %s', (_case, statuses, groupIsLive) => {
    render(
      statuses.map(
        (status, index): ContentBlock => ({
          type: 'tool_call',
          toolCall: {
            id: `call-${index}`,
            name: 'search_docs',
            status,
            displayTitle: `Searching Sim docs ${index}`,
          },
        })
      )
    )
    act(() => vi.advanceTimersByTime(1_500))
    const header = container.querySelector('[data-agent-group] [role="status"]')
    expect(Boolean(header?.querySelector('[class*="shimmer"]'))).toBe(groupIsLive)
    expect(thinking()).toHaveLength(groupIsLive ? 0 : 1)
  })

  it.each(['error', 'cancelled'] as const)(
    'lets thinking bridge the gap after a %s main call',
    (status) => {
      render([
        {
          type: 'tool_call',
          toolCall: { id: 'read', name: 'read', status, displayTitle: 'Reading notes' },
        },
      ])
      act(() => vi.advanceTimersByTime(1_500))
      expect(thinking()).toHaveLength(1)
      expect(container.querySelector('[data-agent-group] [class*="shimmer"]')).toBeNull()
    }
  )

  describe('subagent lane', () => {
    const laneCall = (index: number, status: ToolCallStatus): ContentBlock => ({
      type: 'tool_call',
      spanId: 'workflow',
      toolCall: {
        id: `lane-${index}`,
        name: 'search_docs',
        calledBy: 'workflow',
        status,
        displayTitle: `Searching Sim docs ${index}`,
      },
      timestamp: 2 + index,
    })
    const liveHeaders = () =>
      container.querySelectorAll('[data-agent-group] [role="button"] [class*="shimmer"]')

    it.each([
      ['success then error', ['success', 'error'], false],
      ['success then stopped', ['success', 'cancelled'], false],
      ['error then success', ['error', 'success'], true],
      ['success then running', ['success', 'executing'], true],
    ] as const)('decides the open lane from its latest call: %s', (_case, statuses, laneIsLive) => {
      render([start('workflow'), ...statuses.map((status, index) => laneCall(index, status))])
      act(() => vi.advanceTimersByTime(1_500))
      expect(liveHeaders()).toHaveLength(laneIsLive ? 1 : 0)
      expect(thinking()).toHaveLength(laneIsLive ? 0 : 1)
    })

    it('keeps exactly one indicator for an open lane without calls', () => {
      render([start('workflow')])
      act(() => vi.advanceTimersByTime(1_500))
      expect(groups()).toHaveLength(0)
      expect(thinking()).toHaveLength(1)

      render([
        start('workflow'),
        { type: 'subagent_text', spanId: 'workflow', content: 'Planning.', timestamp: 2 },
      ])
      act(() => vi.advanceTimersByTime(1_500))
      expect(groups()).toHaveLength(1)
      expect(liveHeaders()).toHaveLength(1)
      expect(thinking()).toHaveLength(0)
    })
  })

  it('shares one indicator across parallel and nested empty agents', () => {
    render([start('workflow'), start('browser'), start('deploy', 'workflow')])
    expect(thinking()).toHaveLength(1)
    expect(groups()).toHaveLength(0)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('hands off immediately to meaningful activity without remounting existing rows', () => {
    const blocks = [start('workflow'), start('browser')]
    render(blocks)
    expect(thinking()).toHaveLength(1)
    render([...blocks, tool('workflow')])
    expect(thinking()).toHaveLength(0)
    expect(groups()).toHaveLength(1)
    const firstRow = container.querySelector('[role="status"]')
    expect(firstRow?.textContent).toBe('Reading workflow notes')
    render([...blocks, tool('workflow'), tool('browser')])
    expect(groups()).toHaveLength(2)
    expect(container.querySelector('[role="status"]')).toBe(firstRow)
    expect(thinking()).toHaveLength(0)
  })

  it('shows the pending indicator after the only visible agent finishes', () => {
    const blocks = [start('workflow'), start('browser'), tool('workflow', 'success')]
    render(blocks)
    expect(thinking()).toHaveLength(0)
    render([...blocks, { type: 'subagent_end', spanId: 'workflow', timestamp: 3 }])
    expect(thinking()).toHaveLength(1)
    expect(groups()).toHaveLength(1)
  })

  it('keeps a singleton action flat when its nested agent has no output', () => {
    render([start('workflow'), tool('workflow'), start('deploy', 'workflow')])
    expect(groups()).toHaveLength(1)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('[role="button"]')).toBeNull()
    expect(thinking()).toHaveLength(0)
  })

  it('retains nested activity while another child is empty', () => {
    render([
      start('workflow'),
      start('deploy', 'workflow'),
      start('browser', 'workflow'),
      tool('deploy'),
    ])
    const trigger = container.querySelector<HTMLElement>('[role="button"]')!
    act(() => trigger.click())
    expect(container.querySelector('[data-state="open"]')?.textContent).toContain(
      'Reading deploy notes'
    )
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(2)
    expect(thinking()).toHaveLength(0)
  })

  it('preserves narration and skips whitespace-only output', () => {
    const blocks: ContentBlock[] = [
      start('workflow'),
      { type: 'subagent_text', spanId: 'workflow', content: '  ', timestamp: 2 },
    ]
    render(blocks)
    expect(groups()).toHaveLength(0)
    expect(thinking()).toHaveLength(1)
    render(
      [
        ...blocks,
        { type: 'subagent_text', spanId: 'workflow', content: 'Checking the setup.', timestamp: 3 },
      ],
      false
    )
    expect(groups()).toHaveLength(1)
    act(() => container.querySelector<HTMLElement>('[role="button"]')!.click())
    expect(container.querySelector('[data-state="open"]')?.textContent).toContain(
      'Checking the setup.'
    )
  })

  it.each([
    ['awaiting_approval', 0],
    ['cancelled', 1],
  ] as const)(
    'keeps %s tool rows visible while another agent is pending',
    (status, thinkingRows) => {
      render([start('workflow'), start('browser'), tool('workflow', status)])
      expect(groups()).toHaveLength(1)
      expect(container.querySelector('[role="status"]')?.textContent).toContain('workflow notes')
      expect(thinking()).toHaveLength(thinkingRows)
    }
  )

  it.each(['error', 'rejected'] as const)(
    'keeps %s details inside an expandable group while another agent is pending',
    (status) => {
      render([start('workflow'), start('browser'), tool('workflow', status)])
      expect(groups()).toHaveLength(1)
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Reading workflow notes')
      expect(container.textContent).not.toContain('Failed')
      expect(thinking()).toHaveLength(1)

      const disclosure = container.querySelector<HTMLElement>('[role="button"]')!
      expect(disclosure.getAttribute('aria-expanded')).toBe('false')
      act(() => disclosure.click())
      expect(disclosure.getAttribute('aria-expanded')).toBe('true')
      expect(container.querySelector('[data-state="open"]')?.textContent).toContain(
        'Reading workflow notes'
      )
      expect(thinking()).toHaveLength(1)
    }
  )

  it('keeps interrupted subagent details visible with neutral styling and no active shimmer', () => {
    const error = 'Subagent interrupted during run recovery.'
    render(
      [{ ...start('task'), subagentName: 'Build wakeups and delivery', endedAt: 2, error }],
      false
    )
    expect(container.textContent).toContain('Build wakeups and delivery')
    const detail = Array.from(container.querySelectorAll('p')).find(
      (node) => node.textContent === error
    )
    expect(detail).toBeDefined()
    expect(detail?.className).toContain('--text-tertiary')
    expect(container.innerHTML).not.toContain('--text-error')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
  })

  it('keeps thinking hidden while prose streams and finishes revealing', () => {
    const blocks: ContentBlock[] = [
      start('browser'),
      {
        type: 'text',
        content: 'Here is the result of reviewing the project and checking its configuration.',
        timestamp: 3,
      },
    ]
    render([start('browser'), { type: 'text', content: 'Here is', timestamp: 3 }])
    render(blocks)
    act(() => vi.advanceTimersByTime(100))
    expect(thinking()).toHaveLength(0)
    render(blocks, false)
    expect(thinking()).toHaveLength(0)
  })

  it('waits for the normal quiet period between prose chunks while an agent is pending', () => {
    const prose = 'Here is the result of reviewing the project and checking its configuration.'
    const blocks: ContentBlock[] = [
      start('browser'),
      { type: 'text', content: prose, timestamp: 3 },
    ]
    render(blocks)
    expect(thinking()).toHaveLength(0)
    act(() => vi.advanceTimersByTime(1_499))
    expect(thinking()).toHaveLength(0)
    act(() => vi.advanceTimersByTime(1))
    expect(thinking()).toHaveLength(1)
    render([...blocks, { type: 'text', content: ' The configuration is valid.', timestamp: 4 }])
    expect(thinking()).toHaveLength(0)
  })

  it('removes thinking when a turn stops or finishes without agent output', () => {
    const blocks = [start('workflow'), start('browser')]
    render(blocks)
    expect(thinking()).toHaveLength(1)
    render([...blocks, { type: 'stopped', timestamp: 3 }], false)
    expect(thinking()).toHaveLength(0)
    expect(groups()).toHaveLength(0)
    expect(container.textContent).toContain('Stopped')
    render(blocks, false)
    expect(thinking()).toHaveLength(0)
    expect(groups()).toHaveLength(0)
  })
  describe('one live indicator per lane', () => {
    const call = (
      id: string,
      name: string,
      status: ToolCallStatus,
      extra: Partial<NonNullable<ContentBlock['toolCall']>> = {},
      spanId?: string
    ): ContentBlock => ({
      type: 'tool_call',
      spanId,
      toolCall: { id, name, status, displayTitle: `Title ${id}`, ...extra },
      timestamp: 2,
    })
    const search = (id: string, status: ToolCallStatus, startedAtMs = 1) =>
      call(id, 'search_workspace', status, { params: { query: `Query ${id}` }, startedAtMs })
    const liveRows = () =>
      [...container.querySelectorAll('[data-agent-group] [class*="shimmer"]')].map(
        (node) => node.closest('[role="status"]')?.textContent ?? ''
      )
    const settle = (blocks: ContentBlock[]) => {
      render(blocks)
      act(() => vi.advanceTimersByTime(1_500))
    }

    it.each([
      [
        'a running search before a finished call',
        [search('s', 'executing'), call('r', 'search_docs', 'success')],
        'Title s',
      ],
      [
        'a still-streaming search before a finished call',
        [call('s', 'search_workspace', 'executing'), call('r', 'search_docs', 'success')],
        'Title s',
      ],
      [
        'an older search and a newer call both running',
        [search('s', 'executing', 1), call('r', 'search_docs', 'executing', { startedAtMs: 2 })],
        'Title r',
      ],
      [
        'an older call and a newer search both running',
        [call('r', 'search_docs', 'executing', { startedAtMs: 1 }), search('s', 'executing', 2)],
        'Title s',
      ],
    ] as const)('shows exactly one indicator for %s', (_case, blocks, live) => {
      settle([...blocks])
      expect(liveRows()).toEqual([live])
      expect(thinking()).toHaveLength(0)
    })

    it.each([
      [
        'a pending approval that splits the lane',
        [
          call('r', 'search_docs', 'executing'),
          call('approval', 'edit_workflow', 'awaiting_approval'),
          call('w', 'web_search', 'success'),
        ],
      ],
      [
        'a terminal handoff',
        [
          call('r', 'search_docs', 'success'),
          call('handoff', 'terminal', 'executing', {
            params: { operation: 'handoff', args: { reason: 'Sign in' } },
          }),
        ],
      ],
      [
        'a browser takeover',
        [
          call('r', 'search_docs', 'success'),
          call('takeover', 'browser_request_takeover', 'executing', {
            params: { reason: 'Pick a seat' },
          }),
        ],
      ],
    ] as const)('shows no indicator and no thinking while waiting on %s', (_case, blocks) => {
      settle([...blocks])
      expect(liveRows()).toEqual([])
      expect(thinking()).toHaveLength(0)
    })

    it('shows no indicator in a nested lane waiting on an approval', () => {
      settle([
        start('workflow'),
        call('parent', 'search_docs', 'executing', { calledBy: 'workflow' }, 'workflow'),
        start('deploy', 'workflow'),
        call('approve', 'deploy_as_api', 'awaiting_approval', { calledBy: 'deploy' }, 'deploy'),
      ])
      expect(liveRows()).toEqual([])
      expect(thinking()).toHaveLength(0)
    })

    it('keeps a running parallel lane live while the main lane waits on an approval', () => {
      settle([
        start('workflow'),
        call('w', 'search_docs', 'executing', { calledBy: 'workflow' }, 'workflow'),
        call('approval', 'edit_workflow', 'awaiting_approval'),
      ])
      expect(liveRows()).toEqual(['Title w'])
      expect(thinking()).toHaveLength(0)
    })

    it('hands the indicator to a visible nested lane instead of shimmering both', () => {
      settle([
        start('workflow'),
        call('parent', 'search_docs', 'success', { calledBy: 'workflow' }, 'workflow'),
        start('deploy', 'workflow'),
        call('child', 'search_docs', 'executing', { calledBy: 'deploy' }, 'deploy'),
      ])
      expect(liveRows()).toEqual(['Title child'])
      const parentHeader = container.querySelector<HTMLElement>('[role="button"]')!
      act(() => parentHeader.click())
      const live = container.querySelectorAll('[data-agent-group] [class*="shimmer"]')
      expect(live).toHaveLength(1)
      expect(parentHeader.contains(live[0])).toBe(false)
      expect(thinking()).toHaveLength(0)
    })

    it('keeps the indicator on the parent when a nested lane has already ended', () => {
      settle([
        start('workflow'),
        call('parent', 'search_docs', 'success', { calledBy: 'workflow' }, 'workflow'),
        start('deploy', 'workflow'),
        call(
          'child',
          'search_docs',
          'success',
          { calledBy: 'deploy', displayTitle: 'Searching Sim docs child' },
          'deploy'
        ),
        { type: 'subagent_end', spanId: 'deploy', timestamp: 3 },
      ])
      const parentHeader = container.querySelector<HTMLElement>('[role="button"]')!
      act(() => parentHeader.click())
      const live = container.querySelectorAll('[data-agent-group] [class*="shimmer"]')
      expect(live).toHaveLength(1)
      expect(parentHeader.contains(live[0])).toBe(true)
      expect(parentHeader.textContent).toContain('Searching Sim docs child')
      expect(thinking()).toHaveLength(0)
    })

    it.each([
      ['main', undefined],
      ['subagent', 'workflow'],
    ] as const)(
      'reads a %s activity whose latest call failed as finished, not in progress',
      (_lane, spanId) => {
        const calledBy = spanId ? { calledBy: spanId } : {}
        settle([
          ...(spanId ? [start(spanId)] : []),
          call(
            'a',
            'search_docs',
            'success',
            { ...calledBy, displayTitle: 'Searching Sim docs a' },
            spanId
          ),
          call('b', 'search_docs', 'error', { ...calledBy, displayTitle: 'Searching b' }, spanId),
        ])
        const header = container.querySelector('[data-agent-group] [role="status"]')
        expect(header?.textContent).toBe('Searched Sim docs a')
        expect(header?.querySelector('[class*="shimmer"]')).toBeNull()
        expect(thinking()).toHaveLength(1)
      }
    )

    it('shows one indicator for each parallel subagent lane', () => {
      settle([
        start('workflow'),
        start('research'),
        call('w', 'search_docs', 'executing', { calledBy: 'workflow' }, 'workflow'),
        call('r', 'web_search', 'executing', { calledBy: 'research' }, 'research'),
      ])
      expect(liveRows()).toHaveLength(2)
      expect(thinking()).toHaveLength(0)
    })

    it('leaves the wait of an open subagent lane that failed to the thinking row', () => {
      settle([
        { ...start('workflow'), error: 'Subagent failed.' },
        call('w', 'search_docs', 'success', { calledBy: 'workflow' }, 'workflow'),
      ])
      expect(liveRows()).toEqual([])
      expect(thinking()).toHaveLength(1)
    })

    it.each([
      ['a stopped call', ['success', 'cancelled'], 'Searched Sim docs a · 1 stopped'],
      ['only stopped calls', ['cancelled', 'cancelled'], '2 tool calls · 2 stopped'],
      ['every call succeeded', ['success', 'success'], 'Inspected the docs'],
    ] as const)(
      'summarizes a finished activity with %s under one rule',
      (_case, statuses, header) => {
        const activity = {
          id: 'inspect',
          title: 'Inspecting the docs',
          completedTitle: 'Inspected the docs',
        }
        render(
          statuses.map((status, index) =>
            call(['a', 'b'][index], 'search_docs', status, {
              displayTitle: `Searching Sim docs ${['a', 'b'][index]}`,
              params: { activity },
            })
          ),
          false
        )
        expect(container.querySelector('[data-agent-group] [role="status"]')?.textContent).toBe(
          header
        )
      }
    )
  })
})
