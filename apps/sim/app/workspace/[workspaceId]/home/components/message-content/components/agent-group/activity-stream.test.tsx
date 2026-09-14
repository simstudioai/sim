/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

function tool(id: string, status: ToolCallStatus = 'executing'): ToolCallData {
  return { id, toolName: 'read', displayTitle: `Reading ${id}`, status }
}

function items(tools: ToolCallData[]): AgentGroupItem[] {
  return tools.map((data) => ({ type: 'tool', data }))
}

describe.each(['mothership', 'workflow', 'browser', 'deploy'])('%s activity', (agentName) => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
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
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const render = (tools: ToolCallData[], active = true) =>
    act(() =>
      root.render(
        <AgentGroup
          agentName={agentName}
          agentLabel='Agent prefix'
          items={items(tools)}
          isStreaming={active}
          isLaneOpen={active}
        />
      )
    )
  const header = () => container.querySelector('[role="status"]')
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

  it('leaves empty lanes to the turn indicator and shows the first action immediately', () => {
    render([])
    expect(container.childElementCount).toBe(0)
    advance(100)
    render([tool('first')])
    expect(header()?.textContent).toBe('Reading first')
    const row = header()
    render([tool('first', 'success')], false)
    expect(header()?.textContent).toBe('Read first')
    expect(header()).toBe(row)
  })

  it('preserves a successful model description in the header and expanded history', () => {
    const completed = {
      ...tool('first', 'success'),
      activityDescription: 'Read the latest inbox emails',
    }
    render([completed], false)
    expect(header()?.textContent).toBe(completed.activityDescription)
    render([completed, tool('second', 'success')], false)
    const trigger = container.querySelector<HTMLElement>('[role="button"]')!
    act(() => trigger.click())
    expect(container.querySelector('[data-state="open"]')?.textContent).toContain(
      completed.activityDescription
    )
    expect(container.textContent).not.toContain('Completed:')
  })

  it('shows the first action immediately and coalesces bursts without replaying a backlog', () => {
    render([])
    advance(100)
    render([tool('first')])
    expect(header()?.textContent).toBe('Reading first')
    const row = header()
    const shimmer = container.querySelector('[class*="shimmer"]')
    advance(100)
    render([tool('first', 'success')])
    expect(header()?.textContent).toBe('Reading first')
    expect(container.querySelector('[class*="shimmer"]')).toBe(shimmer)
    render([tool('first', 'success'), tool('second')])
    expect(header()).toBe(row)
    expect(container.querySelector('[class*="shimmer"]')).toBe(shimmer)
    expect(header()?.textContent).toBe('Reading first')
    advance(600)
    render([tool('first', 'success'), tool('second', 'success'), tool('third')])
    advance(299)
    expect(header()?.textContent).toBe('Reading first')
    advance(1)
    expect(header()?.textContent).toBe('Reading third')
    expect(container.textContent).not.toContain('Agent prefix')
    advance(1000)
    expect(header()?.textContent).toBe('Reading third')
  })

  it('keeps live history complete under a stable expanded header with keyboard disclosure', () => {
    render([tool('first', 'success'), tool('second')])
    const trigger = container.querySelector<HTMLElement>('[role="button"]')!
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    act(() => trigger.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(header()?.textContent).toBe('Tool activity')
    render([tool('first', 'success'), tool('second', 'success'), tool('third')])
    expect(header()?.textContent).toBe('Tool activity')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Read firstRead secondReading third'
    )
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(header()?.textContent).toBe('Reading third')
  })

  it.each(['error', 'cancelled', 'interrupted', 'rejected', 'skipped'] as const)(
    'shows %s immediately and cancels a pending cosmetic update',
    (status) => {
      render([tool('first')])
      advance(100)
      render([tool('first', 'success'), tool('second')])
      render([tool('first', 'success'), tool('second', status)])
      const prefix =
        status === 'error' || status === 'rejected'
          ? 'Failed'
          : status === 'skipped'
            ? 'Skipped'
            : 'Stopped'
      expect(header()?.textContent).toBe(`${prefix} reading second`)
      expect(container.querySelector('[class*="shimmer"]')).toBeNull()
      advance(1500)
      expect(header()?.textContent).toBe(`${prefix} reading second`)
    }
  )

  it('shows final completion immediately and never replays the held action', () => {
    render([tool('first')])
    advance(100)
    render([tool('first', 'success'), tool('second')])
    render([tool('first', 'success'), tool('second', 'success')], false)
    expect(header()?.textContent).toBe('Read files')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
    advance(2000)
    expect(header()?.textContent).toBe('Read files')
  })

  it.each(['error', 'cancelled', 'interrupted', 'rejected', 'skipped'] as const)(
    'keeps an earlier parallel call active when the latest one becomes %s',
    (status) => {
      render([tool('first'), tool('second')])
      advance(100)
      render([tool('first'), tool('second', status)])
      const outcome =
        status === 'error' || status === 'rejected'
          ? 'failed'
          : status === 'skipped'
            ? 'skipped'
            : 'stopped'
      expect(header()?.textContent).toBe(`Reading first · 1 ${outcome}`)
      expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
      advance(1000)
      expect(header()?.textContent).toBe(`Reading first · 1 ${outcome}`)
    }
  )

  it('surfaces an earlier parallel failure while the latest call keeps working', () => {
    render([tool('first'), tool('second')])
    advance(100)
    render([tool('first', 'error'), tool('second')])
    expect(header()?.textContent).toBe('Reading second · 1 failed')
  })

  it('keeps narration from prematurely completing an open lane', () => {
    act(() =>
      root.render(
        <AgentGroup
          agentName={agentName}
          agentLabel='Sim'
          isStreaming
          isLaneOpen
          items={[
            ...items([tool('first', 'success')]),
            { type: 'text', content: 'Checking another source.' },
            ...items([tool('second', 'success')]),
          ]}
        />
      )
    )
    const rows = container.querySelectorAll('[role="status"]')
    if (agentName === 'mothership') {
      expect(rows[0].textContent).toBe('Read first')
      expect(rows[0].querySelector('[class*="shimmer"]')).toBeNull()
    }
    const liveRow = rows[rows.length - 1]
    expect(liveRow.textContent).toBe('Reading second')
    expect(liveRow.querySelector('[class*="shimmer"]')).not.toBeNull()
  })
})
