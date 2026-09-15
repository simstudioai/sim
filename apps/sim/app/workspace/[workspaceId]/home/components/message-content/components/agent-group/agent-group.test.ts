/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import {
  type AgentGroupItem,
  AgentGroupView,
  isAgentGroupResolved,
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
    ['success', 'Checked search requirements'],
    ['error', '1 tool call'],
    ['cancelled', 'Stopped searching'],
    ['skipped', 'Skipped searching'],
    ['interrupted', 'Stopped searching'],
    ['rejected', '1 tool call'],
  ] as const)('uses an honest grouped activity label after %s', (status, expected) => {
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

  it('counts unresolved calls and waits for a lane boundary before showing completed activity', () => {
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
    expect(render(['executing', 'executing', 'success']).textContent).toBe('Reading document 1 + 1')
    expect(render(['executing', 'success', 'success']).textContent).toBe('Reading document 0')
    expect(render(['success', 'success', 'success']).textContent).toBe('Read document 2')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
    const completed = render(['success', 'success', 'success'], false)
    expect(completed.textContent).toBe('Built Search API')
    expect(completed.querySelector('svg')).toBeNull()
    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
    expect(container.querySelector('[data-state="open"] svg')).not.toBeNull()
  })

  it.each(['sim_cli', 'run_code'])(
    'shows %s argument preparation before its concrete call',
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
        return container.textContent
      }
      expect(render({}, 'executing')).toBe('Working…')
      const params = { code: '1', activity: { id: 'check', completedTitle: 'Checked inputs' } }
      expect(render(params, 'executing')).toBe('Running checks')
      expect(render(params, 'success')).toBe('Ran checks')
      expect(render(params, 'success', false)).toBe('Checked inputs')
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

  it('keeps earlier failures in expanded history when completed activities collapse', () => {
    act(() =>
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          activity: { id: 'second', completedTitle: 'Checked inputs' },
          completedGroupCount: 2,
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
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Checked inputs + 1')
    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
    expect(container.textContent).toContain('Failed reading first document')
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
      expect(container.textContent).not.toContain('Failed')
      expect(container.textContent).toContain('1 tool call')
      const disclosure = container.querySelector<HTMLElement>('[role="button"]')
      expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
      act(() => disclosure?.click())
      expect(container.textContent).toContain('Failed reading notes')
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
        status === 'executing' ? 'Viewing image.png' : 'Viewed image.png + 2'
      )
      act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
      expect(container.textContent).toContain('Failed reading image.png')
      expect(container.textContent).toContain('Failed reading notes')
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
    expect(container.textContent).toBe('Reading notes + 1')
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
    expect(container.textContent).toBe('Read notes + 1')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
    const header = container.querySelector<HTMLElement>('[role="button"]')
    act(() => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Searched filesRead notes'
    )
    act(() => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toBe('Read notes + 1')
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
      expect(header?.textContent).toBe('Tool activity')
      expect(header).toHaveAccessibleName('Tool activity')
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
      expect(header?.textContent).toBe('Tool activity')
      expect(header).toHaveAccessibleName('Tool activity')
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
      expect(header?.textContent).toBe('Waited + 2')
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
                  icon: createElement('svg', { 'data-tool-call-id': toolCallId }),
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
                  icon: createElement('svg', { 'data-tool-call-id': toolCallId }),
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

  it('falls back to the last tool at any depth when nothing is running', () => {
    const header = render([
      namedTool('Reading workflow', 'success' as ToolCallStatus, 1),
      group([namedTool('Deploying Invoice Sync as API', 'success' as ToolCallStatus, 2)]),
    ])
    expect(header).toContain('Deploying Invoice Sync as API')
  })
})
