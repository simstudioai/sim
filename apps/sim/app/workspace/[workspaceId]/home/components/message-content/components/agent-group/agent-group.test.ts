/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import { isAgentGroupResolved } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import {
  type AgentGroupItem,
  AgentGroupView,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/lib/browser-agent/transport', () => ({
  isBrowserAgentAvailable: () => true,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags',
  () => ({
    CredentialDisplay: ({ data }: { data: Array<{ name?: string }> }) => data[0]?.name ?? '',
    BrowserTakeoverQuestion: ({ reason, answer }: { reason?: string; answer?: string }) =>
      createElement('div', { 'data-takeover-answer': 'true' }, `${reason}: ${answer}`),
  })
)

let toolSeq = 0

function tool(status: ToolCallStatus): AgentGroupItem {
  toolSeq += 1
  const data: ToolCallData = {
    id: `tool-${toolSeq}`,
    toolName: 'grep',
    displayTitle: 'Searching',
    status,
  }
  return { type: 'tool', data }
}

function text(content: string): AgentGroupItem {
  return { type: 'text', content }
}

function group(items: AgentGroupItem[], isDelegating = false): AgentGroupItem {
  return {
    type: 'agent_group',
    group: {
      id: `group-${toolSeq}`,
      agentName: 'deploy',
      agentLabel: 'Deploy',
      items,
      isDelegating,
      isOpen: true,
    },
  }
}

function browserTakeover(reason: string): Extract<AgentGroupItem, { type: 'tool' }> {
  toolSeq += 1
  return {
    type: 'tool',
    data: {
      id: `takeover-${toolSeq}`,
      toolName: 'browser_request_takeover',
      displayTitle: `Waiting for you: ${reason}`,
      status: 'executing',
      params: { reason },
    },
  }
}

describe('isAgentGroupResolved', () => {
  it('is unresolved when there is no work yet', () => {
    expect(isAgentGroupResolved([])).toBe(false)
    expect(isAgentGroupResolved([text('thinking...')])).toBe(false)
  })

  it('resolves once every own tool is terminal', () => {
    expect(isAgentGroupResolved([tool('success')])).toBe(true)
    expect(isAgentGroupResolved([tool('success'), tool('error')])).toBe(true)
  })

  it('stays unresolved while any own tool is still executing', () => {
    expect(isAgentGroupResolved([tool('success'), tool('executing')])).toBe(false)
  })

  it('resolves a parent whose only work is a finished child group', () => {
    expect(isAgentGroupResolved([group([tool('success')])])).toBe(true)
  })

  it('stays unresolved while a nested child is still delegating', () => {
    expect(isAgentGroupResolved([group([], true)])).toBe(false)
  })

  it('stays unresolved while a nested child has an executing tool', () => {
    expect(isAgentGroupResolved([group([tool('executing')])])).toBe(false)
  })

  it('resolves deep nesting only when every descendant is terminal', () => {
    expect(isAgentGroupResolved([group([group([tool('success')])])])).toBe(true)
    expect(isAgentGroupResolved([group([group([tool('executing')])])])).toBe(false)
  })
})

describe('AgentGroup inline main activity', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it.each(['mothership', 'workflow', 'browser'])(
    'shows one model-described action without a redundant %s disclosure',
    (agentName) => {
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName,
            agentLabel: agentName,
            defaultExpanded: true,
            isLaneOpen: true,
            isStreaming: true,
            items: [
              {
                type: 'tool',
                data: {
                  id: 'described-read',
                  toolName: 'read',
                  displayTitle: 'Reading files',
                  activityDescription: 'Checking the project timeline',
                  status: 'executing',
                },
              },
            ],
          })
        )
      )

      const statuses = [...container.querySelectorAll('[role="status"]')]
      expect(statuses).toHaveLength(1)
      expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
      for (const status of statuses) {
        expect(status.textContent).toContain('Checking the project timeline')
      }
      expect(container.textContent).not.toContain('Reading files')
      expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
    }
  )

  it.each([
    ['executing', 'Reading notes'],
    ['success', 'Read notes'],
    ['error', 'Reading notes'],
    ['cancelled', 'Stopped reading notes'],
    ['skipped', 'Skipped reading notes'],
    ['rejected', 'Reading notes'],
    ['interrupted', 'Stopped reading notes'],
  ] as const)('renders a single %s tool once without a disclosure', (status, expected) => {
    act(() =>
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          items: [
            {
              type: 'tool',
              data: {
                id: 'read',
                toolName: 'read',
                displayTitle: 'Reading notes',
                status,
              },
            },
          ],
          isStreaming: status === 'executing',
        })
      )
    )
    expect(container.textContent).toBe(expected)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
    expect(container.querySelector('[data-state]')).toBeNull()
    expect(Boolean(container.querySelector('[class*="shimmer"]'))).toBe(status === 'executing')
  })

  it('preserves manual expansion when more main-agent tools arrive', () => {
    const items = [tool('success'), tool('executing')]
    const render = (nextItems: AgentGroupItem[]) =>
      act(() => {
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Sim',
            items: nextItems,
            isStreaming: true,
            isLaneOpen: true,
          })
        )
      })
    render(items)
    const header = () => container.querySelector<HTMLElement>('[role="button"][aria-expanded]')
    expect(header()?.getAttribute('aria-expanded')).toBe('false')
    act(() => header()?.click())
    expect(header()?.getAttribute('aria-expanded')).toBe('true')
    render([...items, tool('executing')])
    expect(header()?.getAttribute('aria-expanded')).toBe('true')
    act(() => header()?.click())
    render([...items, tool('executing')])
    expect(header()?.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    ['success', 'Searched'],
    ['error', 'Searching'],
    ['cancelled', 'Stopped searching'],
    ['skipped', 'Skipped searching'],
    ['interrupted', 'Stopped searching'],
    ['rejected', 'Searching'],
  ] as const)('shows the single call directly after %s', (status, expected) => {
    const item = tool(status)
    act(() =>
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          activity: {
            id: 'search',
            completedTitle: 'Checked search requirements',
          },
          items: [item],
          isStreaming: true,
          isLaneOpen: false,
        })
      )
    )
    expect(container.textContent).toBe(expected)
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
  })

  it('keeps the concrete running call distinct from grouped activity intent', () => {
    act(() =>
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          activity: {
            id: 'search',
            completedTitle: 'Checked requirements',
          },
          items: [tool('executing')],
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    )
    expect(container.textContent).toBe('Searching')
    expect(container.textContent).not.toContain('Checking requirements')
  })

  it('keeps an open activity in progress without a call count until the lane closes', () => {
    vi.useFakeTimers()
    const render = (statuses: ToolCallStatus[], isLaneOpen = true) => {
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Sim',
            activity: { id: 'build', completedTitle: 'Built Search API' },
            isStreaming: true,
            isLaneOpen,
            items: statuses.map((status, index) => ({
              type: 'tool' as const,
              data: {
                id: `call-${index}`,
                toolName: 'read',
                displayTitle: `Reading document ${index}`,
                status,
              },
            })),
          })
        )
      )
      act(() => vi.advanceTimersByTime(1000))
      return container.querySelector('[role="status"]')!
    }
    expect(render(['executing', 'executing', 'success']).textContent).toBe('Reading document 1')
    expect(render(['executing', 'success', 'success']).textContent).toBe('Reading document 0')
    const gap = render(['success', 'success', 'success'])
    expect(gap.textContent).toBe('Reading document 2')
    expect(gap.querySelector('[class*="shimmer"]')).not.toBeNull()
    expect(gap.querySelector('svg')).not.toBeNull()
    const completed = render(['success', 'success', 'success'], false)
    expect(completed.textContent).toBe('Built Search API')
    expect(completed.querySelector('[class*="shimmer"]')).toBeNull()
    expect(completed.querySelector('svg')).not.toBeNull()
    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
    expect(container.querySelector('[data-state="open"] svg')).not.toBeNull()
  })

  it.each(['sim_cli', 'run_code'])(
    'names a first %s call by its activity intent, else its own title, while its arguments stream',
    (toolName) => {
      vi.useFakeTimers()
      const render = (
        params: Record<string, unknown>,
        status: ToolCallStatus,
        isLaneOpen = true
      ) => {
        act(() =>
          root.render(
            createElement(AgentGroup, {
              agentName: 'mothership',
              agentLabel: 'Sim',
              isStreaming: true,
              isLaneOpen,
              items: [
                {
                  type: 'tool',
                  data: {
                    id: 'call',
                    toolName,
                    displayTitle: 'Running checks',
                    status,
                    params,
                    streamingArgs: '{"activity":{"id":"check","completedTitle":"Checked inputs"},',
                  },
                },
              ],
            })
          )
        )
        act(() => vi.advanceTimersByTime(1000))
        expect(container.textContent).not.toContain('Working')
        return container.textContent
      }
      expect(render({}, 'executing')).toBe('Running checks')
      expect(render({ activity: { id: 'check', title: 'Checking inputs' } }, 'executing')).toBe(
        'Checking inputs'
      )
      const params = { code: '1', activity: { id: 'check', title: 'Checking inputs' } }
      expect(render(params, 'executing')).toBe('Running checks')
      expect(render(params, 'success')).toBe('Running checks')
      expect(render(params, 'success', false)).toBe('Ran checks')
    }
  )

  it.each([
    [
      'sim_cli',
      { toolName: 'sim_cli', displayTitle: 'Running CLI command', params: {} },
      {
        toolName: 'cli_workflows_list',
        displayTitle: 'Listing workflows',
        params: { args: ['workflows', 'list'] },
      },
    ],
    [
      'run_code',
      { toolName: 'run_code', displayTitle: 'Running code', params: { activity: { id: 'a' } } },
      {
        toolName: 'run_code',
        displayTitle: 'Summing invoices',
        params: { activity: { id: 'a' }, title: 'Summing invoices', code: '1' },
      },
    ],
    [
      'call_integration_tool',
      { toolName: 'call_integration_tool', displayTitle: 'Calling integration', params: {} },
      {
        toolName: 'call_integration_tool',
        displayTitle: 'Sending the report',
        params: {},
        streamingArgs: '{"description":"Sending the report",',
      },
    ],
  ])(
    'keeps the previous call in the live header while a %s call has no title',
    (_name, pending, titled) => {
      vi.useFakeTimers()
      const read = {
        id: 'read',
        toolName: 'read',
        displayTitle: 'Reading notes.md',
        status: 'success' as const,
      }
      const render = (next: Partial<ToolCallData>) => {
        act(() =>
          root.render(
            createElement(AgentGroup, {
              agentName: 'mothership',
              agentLabel: 'Sim',
              activity: { id: 'a', title: 'Reconciling accounts' },
              isStreaming: true,
              isLaneOpen: true,
              items: [
                { type: 'tool', data: read },
                {
                  type: 'tool',
                  data: { id: 'next', status: 'executing', ...next } as ToolCallData,
                },
              ],
            })
          )
        )
        act(() => vi.advanceTimersByTime(1000))
        const header = container.querySelector('[role="status"]')!
        expect(header.querySelector('[class*="shimmer"]')).not.toBeNull()
        expect(container.textContent).not.toContain('Working')
        return { text: header.textContent, icon: header.querySelector('svg')?.outerHTML }
      }
      const iconOf = (data: Partial<ToolCallData>) => {
        act(() =>
          root.render(
            createElement(AgentGroup, {
              agentName: 'mothership',
              agentLabel: 'Sim',
              items: [
                { type: 'tool', data: { id: 'solo', status: 'success', ...data } as ToolCallData },
              ],
            })
          )
        )
        return container.querySelector('svg')?.outerHTML
      }
      const readIcon = iconOf(read)
      const titledIcon = iconOf(titled)
      expect(readIcon).not.toBe(titledIcon)

      expect(render(pending)).toEqual({ text: 'Reading notes.md', icon: readIcon })
      expect(render(titled)).toEqual({ text: titled.displayTitle, icon: titledIcon })
    }
  )

  it('keeps an activity unfinished while a standalone approval is pending', () => {
    act(() =>
      root.render(
        createElement(AgentGroupView, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          activity: { id: 'build', completedTitle: 'Built API' },
          items: [
            {
              type: 'tool',
              data: {
                id: 'read',
                toolName: 'read',
                displayTitle: 'Read configuration',
                status: 'success',
              },
            },
            {
              type: 'tool',
              data: {
                id: 'approval',
                toolName: 'create',
                displayTitle: 'Waiting for approval',
                status: 'awaiting_approval',
              },
            },
          ],
          ToolCallComponent: ({ displayTitle, renderStatus }: ToolCallItemProps) =>
            renderStatus
              ? renderStatus({ label: displayTitle, activeLabel: displayTitle, isActive: false })
              : createElement('div', null, displayTitle),
        })
      )
    )
    expect(container.textContent).toBe('Read configurationWaiting for approval')
    expect(container.textContent).not.toContain('Built API')
  })

  it.each([
    [
      'approval',
      false,
      { id: 'b', toolName: 'grep', displayTitle: 'Searching b', status: 'awaiting_approval' },
    ],
    [
      'approval',
      true,
      { id: 'b', toolName: 'grep', displayTitle: 'Searching b', status: 'awaiting_approval' },
    ],
    [
      'handoff',
      false,
      {
        id: 'b',
        toolName: 'terminal',
        displayTitle: 'Finish signing in',
        status: 'executing',
        params: { operation: 'handoff' },
      },
    ],
    [
      'handoff',
      true,
      {
        id: 'b',
        toolName: 'terminal',
        displayTitle: 'Finish signing in',
        status: 'executing',
        params: { operation: 'handoff' },
      },
    ],
  ] as const)(
    'keeps a finished group completed while a later %s waits on the user (streaming=%s)',
    (_kind, isStreaming, pending) => {
      act(() =>
        root.render(
          createElement(AgentGroupView, {
            agentName: 'mothership',
            agentLabel: 'Sim',
            isStreaming,
            isLaneOpen: true,
            items: [
              {
                type: 'tool',
                data: { id: 'a', toolName: 'read', displayTitle: 'Read a', status: 'success' },
              },
              { type: 'tool', data: { ...pending } as ToolCallData },
            ],
            ToolCallComponent: ({ displayTitle, status, renderStatus }: ToolCallItemProps) =>
              renderStatus
                ? renderStatus({
                    label: displayTitle,
                    activeLabel: displayTitle.replace(/^Read /, 'Reading '),
                    isActive: status === 'executing',
                  })
                : createElement('div', { 'data-pending': 'true' }, displayTitle),
          })
        )
      )
      const header = container.querySelector('[role="status"]')
      expect(header?.textContent).toBe('Read a')
      expect(header?.querySelector('[class*="shimmer"]')).toBeNull()
      expect(container.querySelector('[data-pending]')).not.toBeNull()
    }
  )

  it('keeps an earlier failure in expanded history under the only successful call', () => {
    act(() =>
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          activity: { id: 'second', completedTitle: 'Checked inputs' },
          items: [
            {
              type: 'tool',
              data: {
                id: 'first',
                toolName: 'read',
                displayTitle: 'Reading first document',
                status: 'error',
                params: { activity: { id: 'first' } },
              },
            },
            {
              type: 'tool',
              data: {
                id: 'second',
                toolName: 'read',
                displayTitle: 'Reading second document',
                status: 'success',
                params: { activity: { id: 'second' } },
              },
            },
          ],
        })
      )
    )
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Read second document')
    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
    expect(container.textContent).toContain('Reading first document')
  })

  it.each(['mothership', 'workflow'])(
    'keeps a lone failed %s call accessible under a neutral disclosure',
    (agentName) => {
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName,
            agentLabel: agentName,
            items: [
              {
                type: 'tool',
                data: {
                  id: 'failed-read',
                  toolName: 'read',
                  displayTitle: 'Reading notes',
                  status: 'error',
                },
              },
            ],
          })
        )
      )
      if (agentName === 'mothership') {
        expect(container.textContent).toBe('Reading notes')
        expect(container.querySelector('[aria-expanded]')).toBeNull()
        return
      }
      expect(container.textContent).not.toContain('Failed')
      expect(container.textContent).toContain('Reading notes')
      const disclosure = container.querySelector<HTMLElement>('[role="button"]')
      expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
      act(() => disclosure?.click())
      expect(container.textContent).toContain('Reading notes')
    }
  )

  it.each(['executing', 'success'] as const)(
    'keeps failures out of a %s summary while retaining them in expanded history',
    (status) => {
      const items: AgentGroupItem[] = [
        {
          type: 'tool',
          data: {
            id: 'read-failed',
            toolName: 'read',
            displayTitle: 'Reading image.png',
            status: 'error',
          },
        },
        {
          type: 'tool',
          data: { id: 'view', toolName: 'read', displayTitle: 'Viewing image.png', status },
        },
        {
          type: 'tool',
          data: {
            id: 'later-failed',
            toolName: 'read',
            displayTitle: 'Reading notes',
            status: 'error',
          },
        },
      ]
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Sim',
            items,
            activity: { id: 'inspect', completedTitle: 'Inspected images' },
            isStreaming: status === 'executing',
            isLaneOpen: status === 'executing',
          })
        )
      )
      expect(container.textContent).toBe(
        status === 'executing' ? 'Viewing image.png' : 'Viewed image.png'
      )
      act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
      expect(container.textContent).toContain('Reading image.png')
      expect(container.textContent).toContain('Reading notes')
    }
  )

  it('paces the active status in place and expands the full completed history', () => {
    vi.useFakeTimers()
    const first: AgentGroupItem = {
      type: 'tool',
      data: { id: 'first', toolName: 'grep', displayTitle: 'Searching files', status: 'executing' },
    }
    const next: AgentGroupItem = {
      type: 'tool',
      data: { id: 'next', toolName: 'read', displayTitle: 'Reading notes', status: 'executing' },
    }
    const render = (items: AgentGroupItem[], isStreaming = true) => {
      act(() => {
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Sim',
            items,
            isStreaming,
          })
        )
      })
    }

    render([first])
    expect(container.textContent).toBe('Searching files')
    expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
    const activity = container.firstElementChild

    render([first, next])
    expect(container.firstElementChild).toBe(activity)
    expect(container.textContent).toBe('Searching files')
    act(() => vi.advanceTimersByTime(1000))
    expect(container.textContent).toBe('Reading notes')
    expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
    expect(
      container.querySelector<HTMLElement>('[role="button"]')?.getAttribute('aria-expanded')
    ).toBe('false')
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toContain('Sim')

    render(
      [
        { ...first, data: { ...first.data, status: 'success' } },
        { ...next, data: { ...next.data, status: 'success' } },
      ],
      false
    )
    expect(container.textContent).toBe('Searched files, read files')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
    expect(container.querySelector('[role="status"] svg')).not.toBeNull()
    const header = container.querySelector<HTMLElement>('[role="button"]')
    act(() => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Searched filesRead notes'
    )
    act(() => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toBe('Searched files, read files')
  })

  it('keeps history expanded as new tools arrive', () => {
    const first: AgentGroupItem = {
      type: 'tool',
      data: { id: 'first', toolName: 'read', displayTitle: 'Reading notes', status: 'success' },
    }
    const second: AgentGroupItem = {
      type: 'tool',
      data: {
        id: 'second',
        toolName: 'read',
        displayTitle: 'Reading more notes',
        status: 'success',
      },
    }
    const render = (items: AgentGroupItem[]) =>
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Sim',
            items,
            isStreaming: true,
          })
        )
      )
    render([first, second])
    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
    render([
      first,
      second,
      {
        type: 'tool',
        data: {
          id: 'third',
          toolName: 'terminal_run',
          displayTitle: 'Running checks',
          status: 'executing',
        },
      },
    ])
    expect(
      container.querySelector<HTMLElement>('[role="button"]')?.getAttribute('aria-expanded')
    ).toBe('true')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Read notesRead more notesRunning checks'
    )
  })

  it('shares one countdown and preserves the viewport across active tool changes', () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    try {
      const wait: AgentGroupItem = {
        type: 'tool',
        data: {
          id: 'wait-first',
          toolName: 'wait',
          displayTitle: 'Waiting',
          status: 'executing',
          params: { seconds: 3 },
        },
      }
      const read: AgentGroupItem = {
        type: 'tool',
        data: { id: 'read', toolName: 'read', displayTitle: 'Reading notes', status: 'success' },
      }
      const render = (items: AgentGroupItem[]) =>
        act(() =>
          root.render(
            createElement(AgentGroup, {
              agentName: 'mothership',
              agentLabel: 'Sim',
              items,
              isStreaming: true,
            })
          )
        )
      render([wait])
      act(() => vi.advanceTimersByTime(2000))
      expect(container.textContent).toBe('Waiting 1s')
      expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
      render([wait, read])
      expect(container.textContent).toBe('Waiting 1s')
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      const header = container.querySelector<HTMLElement>('[role="button"]')
      act(() => header?.click())
      expect(header?.hasAttribute('aria-label')).toBe(false)
      expect(header?.textContent).toBe('Waiting 1s')
      expect(header).toHaveAccessibleName('Waiting 1s')
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
        'Waiting 1sRead notes'
      )
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      act(() => header?.click())
      act(() => header?.click())
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
        'Waiting 1sRead notes'
      )
      const viewport = container.querySelector('.overflow-y-auto')
      render([
        { ...wait, data: { ...wait.data, status: 'success' } },
        read,
        { ...wait, data: { ...wait.data, id: 'wait-second' } },
      ])
      expect(header?.textContent).toBe('Waiting 3s')
      expect(header).toHaveAccessibleName('Waiting 3s')
      expect(container.querySelector('.overflow-y-auto')).toBe(viewport)
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
        'WaitedRead notesWaiting 3s'
      )
      expect(setIntervalSpy).toHaveBeenCalledTimes(2)
      render([
        { ...wait, data: { ...wait.data, status: 'success' } },
        read,
        { ...wait, data: { ...wait.data, id: 'wait-second', status: 'success' } },
      ])
      expect(header?.textContent).toBe('Waited, read files')
      expect(container.querySelector('.overflow-y-auto')).toBe(viewport)
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
    } finally {
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it.each(['browser', 'workflow', 'research', 'deploy', 'file', 'table'])(
    'summarizes and expands the full %s activity history',
    (agentName) => {
      const items: AgentGroupItem[] = [
        {
          type: 'tool',
          data: { id: 'read', toolName: 'read', displayTitle: 'Reading notes', status: 'success' },
        },
        {
          type: 'tool',
          data: {
            id: 'run',
            toolName: 'terminal',
            displayTitle: 'Running checks',
            status: 'success',
            params: { operation: 'run' },
          },
        },
      ]
      act(() =>
        root.render(
          createElement(AgentGroupView, {
            agentName,
            agentLabel: 'Agent',
            items,
            ToolCallComponent: ({ toolCallId, displayTitle }: ToolCallItemProps) =>
              createElement('div', { 'data-tool-call-id': toolCallId }, displayTitle),
          })
        )
      )
      const header = container.querySelector<HTMLElement>('[role="button"]')
      expect(header?.textContent).toBe('Read files, ran commands')
      expect(header).toHaveAccessibleName('Read files, ran commands')
      expect(container.querySelectorAll('[data-tool-call-id]')).toHaveLength(0)
      act(() => header?.click())
      expect(
        Array.from(container.querySelectorAll('[data-tool-call-id]'), (row) =>
          row.getAttribute('data-tool-call-id')
        )
      ).toEqual(['read', 'run'])
      act(() => header?.click())
      expect(header?.getAttribute('aria-expanded')).toBe('false')
    }
  )

  it('reveals a nested terminal handoff through collapsed ancestors', () => {
    act(() =>
      root.render(
        createElement(AgentGroupView, {
          agentName: 'workflow',
          agentLabel: 'Workflow',
          isLaneOpen: true,
          isStreaming: true,
          items: [
            group([
              {
                type: 'tool',
                data: {
                  id: 'handoff',
                  toolName: 'terminal',
                  displayTitle: 'Finish signing in',
                  status: 'executing',
                  params: { operation: 'handoff' },
                },
              },
            ]),
          ],
          ToolCallComponent: ({ toolCallId, displayTitle, renderStatus }: ToolCallItemProps) => {
            const status = createElement('div', { 'data-tool-call-id': toolCallId }, displayTitle)
            return renderStatus
              ? renderStatus({
                  label: displayTitle,
                  activeLabel: displayTitle,
                  isActive: true,
                  icon: createElement('svg', { 'data-icon-for': toolCallId }),
                })
              : status
          },
        })
      )
    )
    const headers = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
    expect(headers).toHaveLength(2)
    expect(headers.every((header) => header.getAttribute('aria-expanded') === 'true')).toBe(true)
    act(() => headers[0].click())
    expect(headers[0].getAttribute('aria-expanded')).toBe('true')
    expect(
      container.querySelector('[data-tool-call-id="handoff"]')?.closest('[data-state="closed"]')
    ).toBeNull()
  })

  it('keeps a browser question and answer after the main agent resumes tool activity', () => {
    const takeover = browserTakeover('Choose a result.')
    const items: AgentGroupItem[] = [
      {
        ...takeover,
        data: {
          ...takeover.data,
          status: 'success',
          result: { success: true, output: { userInstruction: 'Open the second result.' } },
        },
      },
      {
        type: 'tool',
        data: {
          id: 'resumed',
          toolName: 'grep',
          displayTitle: 'Searching files',
          status: 'success',
        },
      },
    ]

    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          items,
          isStreaming: false,
        })
      )
    })

    expect(container.querySelector('[data-takeover-answer="true"]')?.textContent).toBe(
      'Choose a result.: Open the second result.'
    )
    expect(container.textContent).toContain('Searched files')
    expect(
      container.querySelector('[data-takeover-answer="true"]')?.closest('[data-state]')
    ).toBeNull()
  })

  it('keeps pending permissions and terminal handoffs visible when newer tools arrive', () => {
    const items: AgentGroupItem[] = [
      {
        type: 'tool',
        data: {
          id: 'permission',
          toolName: 'grep',
          displayTitle: 'Allow search',
          status: 'awaiting_approval',
        },
      },
      {
        type: 'tool',
        data: {
          id: 'handoff',
          toolName: 'terminal',
          displayTitle: 'Finish signing in',
          status: 'executing',
          params: { operation: 'handoff' },
        },
      },
      {
        type: 'tool',
        data: {
          id: 'previous',
          toolName: 'grep',
          displayTitle: 'Searching files',
          status: 'success',
        },
      },
      {
        type: 'tool',
        data: {
          id: 'latest',
          toolName: 'read',
          displayTitle: 'Reading notes',
          status: 'executing',
        },
      },
    ]
    act(() => {
      root.render(
        createElement(AgentGroupView, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          items,
          isStreaming: true,
          ToolCallComponent: ({ toolCallId, displayTitle, renderStatus }: ToolCallItemProps) => {
            const status = createElement('div', { 'data-tool-call-id': toolCallId }, displayTitle)
            return renderStatus
              ? renderStatus({
                  label: displayTitle,
                  activeLabel: displayTitle,
                  isActive: true,
                  icon: createElement('svg', { 'data-icon-for': toolCallId }),
                })
              : status
          },
        })
      )
    })

    expect(
      Array.from(container.querySelectorAll('[data-tool-call-id]'), (row) =>
        row.getAttribute('data-tool-call-id')
      )
    ).toEqual(['permission', 'handoff'])
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Reading notes')
    expect(container.querySelector('[role="status"] [data-icon-for="latest"]')).not.toBeNull()
    expect(
      container.querySelector('[data-tool-call-id="permission"]')?.closest('[data-state]')
    ).toBeNull()
    expect(
      container.querySelector('[data-tool-call-id="handoff"]')?.closest('[data-state]')
    ).toBeNull()
  })
})

describe('AgentGroup browser takeover', () => {
  it('collapses the browser log and renders the question outside its viewport', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)
    const reason = 'Please pick a match in the draw.'

    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'browser',
          agentLabel: 'Browser Agent',
          items: [tool('success'), browserTakeover(reason)],
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    })

    const collapsedLog = container.querySelector('[data-state="closed"]')
    const liftedQuestion = Array.from(container.querySelectorAll('.animate-stream-fade-in')).find(
      (element) => element.textContent === reason
    )
    expect(collapsedLog).not.toBeNull()
    expect(liftedQuestion).toBeDefined()
    expect(collapsedLog?.contains(liftedQuestion ?? null)).toBe(false)

    const header = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
      (button) => button.hasAttribute('aria-expanded')
    )
    act(() => header?.click())
    expect(container.querySelector('[data-state="open"]')).not.toBeNull()
    expect(liftedQuestion?.textContent).toBe(reason)

    act(() => root.unmount())
  })

  it('clears a stale question when the lane closes or a newer tool starts', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)
    const reason = 'Please finish in the browser.'
    const takeover = browserTakeover(reason)

    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'browser',
          agentLabel: 'Browser Agent',
          items: [takeover, tool('executing')],
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    })
    expect(container.querySelector('.animate-stream-fade-in')).toBeNull()

    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'browser',
          agentLabel: 'Browser Agent',
          items: [takeover],
          isStreaming: false,
          isLaneOpen: false,
        })
      )
    })
    expect(container.querySelector('.animate-stream-fade-in')).toBeNull()

    act(() => root.unmount())
  })

  it('moves the answered question back inside the resumed browser agent', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)
    const reason = 'Pick a match from the draw.'
    const takeover = browserTakeover(reason)

    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'browser',
          agentLabel: 'Browser Agent',
          items: [takeover],
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    })
    expect(container.querySelector('.animate-stream-fade-in')).not.toBeNull()

    const completedTakeover: AgentGroupItem = {
      type: 'tool',
      data: {
        ...takeover.data,
        status: 'success',
        result: { success: true, output: { userInstruction: 'Open the second match' } },
      },
    }
    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'browser',
          agentLabel: 'Browser Agent',
          items: [completedTakeover],
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    })

    expect(container.querySelector('.animate-stream-fade-in')).toBeNull()
    // Groups never auto-expand: the answered question lives inside the
    // collapsed log until the user opens it manually.
    const headerToggle = container.querySelector('[role="button"][class*="group/agent"]')
    expect(headerToggle).not.toBeNull()
    act(() => {
      headerToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const resumedLog = container.querySelector('[data-state="open"]')
    const answeredQuestion = container.querySelector('[data-takeover-answer="true"]')
    expect(answeredQuestion?.textContent).toContain(reason)
    expect(answeredQuestion?.textContent).toContain('Open the second match')
    expect(resumedLog?.contains(answeredQuestion)).toBe(true)

    act(() => root.unmount())
  })
})

describe('AgentGroup nested status line', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const namedTool = (
    displayTitle: string,
    status: ToolCallStatus,
    startedAt?: number
  ): AgentGroupItem => ({
    type: 'tool',
    data: {
      id: `${displayTitle}-${startedAt ?? 0}`,
      toolName: 'grep',
      displayTitle,
      status,
      startedAt,
    },
  })

  const render = (items: AgentGroupItem[]) => {
    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'workflow',
          agentLabel: 'Workflow Agent',
          items,
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    })
    return container.textContent ?? ''
  }

  it("shows a nested agent's running tool instead of the parent's finished one", () => {
    const header = render([
      namedTool('Reading workflow', 'success' as ToolCallStatus, 1),
      group([namedTool('Deploying Invoice Sync as API', 'executing' as ToolCallStatus, 2)]),
    ])
    expect(header).toContain('Deploying Invoice Sync as API')
  })

  it('selects the latest running tool across depths', () => {
    const header = render([
      namedTool('Reading workflow', 'executing' as ToolCallStatus, 1),
      group([
        namedTool('Deploying Invoice Sync as API', 'executing' as ToolCallStatus, 3),
        namedTool('Checking deployment status', 'executing' as ToolCallStatus, 2),
      ]),
    ])
    /** The latest start wins across the subtree. */
    expect(header).toContain('Deploying Invoice Sync as API')
  })

  it('keeps the previous call in a subagent header while the next call has no title', () => {
    vi.useFakeTimers()
    const header = (items: AgentGroupItem[]) => {
      render(items)
      act(() => vi.advanceTimersByTime(1000))
      const status = container.querySelector('[role="status"]')!
      expect(status.querySelector('[class*="shimmer"]')).not.toBeNull()
      expect(container.textContent).not.toContain('Working')
      return status.textContent
    }
    const cli = (data: Partial<ToolCallData>): AgentGroupItem => ({
      type: 'tool',
      data: { id: 'cli', status: 'executing', startedAt: 2, ...data } as ToolCallData,
    })
    const pending = cli({ toolName: 'sim_cli', displayTitle: 'Running CLI command', params: {} })
    const titled = cli({
      toolName: 'cli_workflows_list',
      displayTitle: 'Listing workflows',
      params: { args: ['workflows', 'list'] },
    })
    try {
      expect(header([namedTool('Reading workflow', 'success' as ToolCallStatus, 1), pending])).toBe(
        'Reading workflow'
      )
      expect(header([namedTool('Reading workflow', 'success' as ToolCallStatus, 1), titled])).toBe(
        'Listing workflows'
      )
      expect(header([pending])).toBe('Running CLI command')
      expect(
        header([
          cli({
            toolName: 'sim_cli',
            displayTitle: 'Running CLI command',
            params: { activity: { id: 'a', title: 'Checking inputs' } },
          }),
        ])
      ).toBe('Checking inputs')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the last tool at any depth when nothing is running', () => {
    const header = render([
      namedTool('Reading workflow', 'success' as ToolCallStatus, 1),
      group([namedTool('Deploying Invoice Sync as API', 'success' as ToolCallStatus, 2)]),
    ])
    expect(header).toContain('Deploying Invoice Sync as API')
  })
})
