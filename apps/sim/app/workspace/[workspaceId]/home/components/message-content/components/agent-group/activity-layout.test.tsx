/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import type { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/lib/browser-agent/transport', () => ({ isBrowserAgentAvailable: () => true }))

const ICON_SLOT = 'size-[14px]'

function tool(
  id: string,
  toolName = 'search_docs',
  status: ToolCallStatus = 'success'
): AgentGroupItem {
  return { type: 'tool', data: { id, toolName, displayTitle: `Searching ${id}`, status } }
}

function lane(id: string, items: AgentGroupItem[]): AgentGroupItem {
  return {
    type: 'agent_group',
    group: {
      id,
      agentName: 'deploy',
      agentLabel: 'Deploy',
      items,
      isDelegating: false,
      isOpen: false,
    },
  }
}

/** Indentation classes a row or its containers must not carry. */
const hasIndent = (element: Element) =>
  [...element.classList].some((name) => /^(pl|ml|ps|ms)-/.test(name))

describe('flat expanded activity layout', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const render = (agentName: string, items: AgentGroupItem[], error?: string) =>
    act(() =>
      root.render(
        <AgentGroup agentName={agentName} agentLabel='Agent' items={items} error={error} />
      )
    )
  const expand = () => act(() => container.querySelector<HTMLElement>('[role="button"]')!.click())
  const statuses = () => [...container.querySelectorAll<HTMLElement>('[role="status"]')]
  const iconSlot = (status: Element) => status.querySelector(':scope > [aria-hidden="true"]')!
  /** The reserved icon slot of a text-column wrapper. */
  const reservedSlot = (column: Element) => column.querySelector(':scope > [aria-hidden="true"]')

  it.each(['mothership', 'workflow'])(
    'lines %s rows up with the header icon and text columns',
    (agentName) => {
      render(agentName, [tool('a'), tool('b', 'web_search')])
      expand()
      const [header, ...rows] = statuses()
      expect(rows.length).toBeGreaterThan(0)
      for (const row of [header, ...rows]) {
        expect(row.classList).toContain('gap-2')
        expect(iconSlot(row).classList).toContain(ICON_SLOT)
      }
      const list = rows[0].closest('.flex-col')!
      expect(list.classList).toContain('gap-1.5')
      let node: Element | null = rows[0]
      while (node && node !== container) {
        expect(hasIndent(node), node.className).toBe(false)
        node = node.parentElement
      }
    }
  )

  it('keeps a nested lane indented into its parent text column', () => {
    render('workflow', [tool('a'), lane('deploy', [tool('child')])])
    expand()
    const nestedHeader = statuses().find((status) => status.textContent === 'Searched child')!
    const column = nestedHeader.closest('.items-start')!
    expect(column.classList).toContain('gap-2')
    expect(reservedSlot(column)?.classList).toContain(ICON_SLOT)
    expect(reservedSlot(column)?.childElementCount).toBe(0)
  })

  it('puts a lane error on the shared text column instead of a hand-tuned inset', () => {
    render('workflow', [tool('a')], 'Subagent failed.')
    const error = [...container.querySelectorAll('p')].find(
      (node) => node.textContent === 'Subagent failed.'
    )!
    expect(hasIndent(error)).toBe(false)
    const column = error.closest('.items-start')!
    expect(column.classList).toContain('gap-2')
    expect(reservedSlot(column)?.classList).toContain(ICON_SLOT)
  })

  it('keeps search and ordinary tool rows in the same history with shared spacing', () => {
    render('mothership', [
      tool('a'),
      {
        type: 'tool',
        data: {
          id: 's1',
          toolName: 'search_workspace',
          displayTitle: 'Searching',
          status: 'success',
          params: { query: 'first' },
        },
      },
      {
        type: 'tool',
        data: {
          id: 's2',
          toolName: 'search_workspace',
          displayTitle: 'Searching',
          status: 'success',
          params: { query: 'second' },
        },
      },
    ])
    const blocks = container.querySelector('.flex-col.gap-3')!
    expect(blocks.contains(statuses()[0])).toBe(true)
    expect(blocks.classList).toContain('gap-3')
    expect(blocks.classList).not.toContain('gap-1.5')
    expect(statuses()).toHaveLength(1)
    expand()
    const rows = statuses().slice(1)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.closest('.flex-col')!.classList).toContain('gap-1.5')
      expect(iconSlot(row).classList).toContain(ICON_SLOT)
    }
  })
})
