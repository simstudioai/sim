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
  })

  it('replaces the active status in place and expands the full completed history', () => {
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
    const activity = container.firstElementChild

    render([first, next])
    expect(container.firstElementChild).toBe(activity)
    expect(container.textContent).toBe('Reading notes')
    expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
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
    const header = container.querySelector('button')
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
    render([first])
    act(() => container.querySelector('button')?.click())
    render([
      first,
      {
        type: 'tool',
        data: {
          id: 'second',
          toolName: 'terminal_run',
          displayTitle: 'Running checks',
          status: 'executing',
        },
      },
    ])
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Read notesRunning checks'
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
      const header = container.querySelector('button')
      act(() => header?.click())
      expect(header?.hasAttribute('aria-label')).toBe(false)
      expect(header?.textContent).toBe('Waiting 1s')
      expect(header).toHaveAccessibleName('Waiting 1s')
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe('Waiting 1s')
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      act(() => header?.click())
      act(() => header?.click())
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe('Waiting 1s')
      const viewport = container.querySelector('.overflow-y-auto')
      render([
        { ...wait, data: { ...wait.data, status: 'success' } },
        { ...wait, data: { ...wait.data, id: 'wait-second' } },
      ])
      expect(header?.textContent).toBe('Waiting 3s')
      expect(header).toHaveAccessibleName('Waiting 3s')
      expect(container.querySelector('.overflow-y-auto')).toBe(viewport)
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe('WaitedWaiting 3s')
      expect(setIntervalSpy).toHaveBeenCalledTimes(2)
      render([
        { ...wait, data: { ...wait.data, status: 'success' } },
        { ...wait, data: { ...wait.data, id: 'wait-second', status: 'success' } },
      ])
      expect(header?.textContent).toBe('Waited')
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
      const header = container.querySelector('button')
      expect(header?.textContent).toBe('Agent — Read files, ran commands')
      expect(header).toHaveAccessibleName('Agent — Read files, ran commands')
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
            return renderStatus ? renderStatus(status) : status
          },
        })
      )
    )
    const headers = Array.from(container.querySelectorAll('button'))
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
            return renderStatus ? renderStatus(status) : status
          },
        })
      )
    })

    expect(
      Array.from(container.querySelectorAll('[data-tool-call-id]'), (row) =>
        row.getAttribute('data-tool-call-id')
      )
    ).toEqual(['permission', 'handoff', 'latest'])
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

    const header = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Browser Agent')
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
    const headerToggle = container.querySelector('button[class*="group/agent"]')
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
    expect(header).toContain('Workflow Agent — Deploying Invoice Sync as API')
  })

  it('counts running tools across depths with the + n suffix', () => {
    const header = render([
      namedTool('Reading workflow', 'executing' as ToolCallStatus, 1),
      group([
        namedTool('Deploying Invoice Sync as API', 'executing' as ToolCallStatus, 3),
        namedTool('Checking deployment status', 'executing' as ToolCallStatus, 2),
      ]),
    ])
    // Latest start wins; the other two running become the overflow count.
    expect(header).toContain('Deploying Invoice Sync as API + 2')
  })

  it('falls back to the last tool at any depth when nothing is running', () => {
    const header = render([
      namedTool('Reading workflow', 'success' as ToolCallStatus, 1),
      group([namedTool('Deploying Invoice Sync as API', 'success' as ToolCallStatus, 2)]),
    ])
    expect(header).toContain('Workflow Agent — Deploying Invoice Sync as API')
  })
})
