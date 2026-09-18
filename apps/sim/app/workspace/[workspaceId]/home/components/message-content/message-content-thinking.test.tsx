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
    'shows thinking after main tools finish and yields to the next tool (spanId=%s)',
    (spanId) => {
      const mainCall = (id: string, status: ToolCallStatus): ContentBlock => ({
        type: 'tool_call',
        spanId,
        toolCall: {
          id,
          name: 'sim_cli',
          status,
          displayTitle: 'List tables in Alfred',
          params: {
            args: ['tables', 'list'],
            activity: {
              id: 'inspect',
              title: 'Inspecting workspace resources',
              completedTitle: 'Inspected workspace resources',
            },
          },
        },
      })
      render([mainCall('first', 'executing')])
      act(() => vi.advanceTimersByTime(1_500))
      expect(thinking()).toHaveLength(0)
      expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()

      const completed = [mainCall('first', 'success')]
      render(completed)
      expect(thinking()).toHaveLength(0)
      act(() => vi.advanceTimersByTime(1_500))
      expect(thinking()).toHaveLength(1)
      expect(container.querySelector('[aria-hidden="false"]')?.textContent).toContain('Thinking')

      render([...completed, { type: 'thinking', content: 'Checking the result.', timestamp: 3 }])
      expect(thinking()).toHaveLength(1)
      render([...completed, mainCall('next', 'executing')])
      expect(thinking()).toHaveLength(0)

      const finished = [...completed, mainCall('next', 'success')]
      render(finished)
      act(() => vi.advanceTimersByTime(1_500))
      expect(thinking()).toHaveLength(1)
      render(finished, false)
      expect(thinking()).toHaveLength(0)
    }
  )

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

  it.each(['awaiting_approval', 'cancelled'] as const)(
    'keeps %s tool rows visible while another agent is pending',
    (status) => {
      render([start('workflow'), start('browser'), tool('workflow', status)])
      expect(groups()).toHaveLength(1)
      expect(container.querySelector('[role="status"]')?.textContent).toContain('workflow notes')
      expect(thinking()).toHaveLength(1)
    }
  )

  it.each(['error', 'rejected'] as const)(
    'keeps %s details inside an expandable group while another agent is pending',
    (status) => {
      render([start('workflow'), start('browser'), tool('workflow', status)])
      expect(groups()).toHaveLength(1)
      expect(container.querySelector('[role="status"]')?.textContent).toBe('1 tool call')
      expect(container.textContent).not.toContain('workflow notes')
      expect(thinking()).toHaveLength(1)

      const disclosure = container.querySelector<HTMLElement>('[role="button"]')!
      expect(disclosure.getAttribute('aria-expanded')).toBe('false')
      act(() => disclosure.click())
      expect(disclosure.getAttribute('aria-expanded')).toBe('true')
      expect(container.querySelector('[data-state="open"]')?.textContent).toContain(
        'Failed reading workflow notes'
      )
      expect(thinking()).toHaveLength(1)
    }
  )

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
})
