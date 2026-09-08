/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallData, ToolCallStatus } from '../../../../types'
import type { AgentGroupItem } from './agent-group'
import { AgentGroup, isAgentGroupResolved } from './agent-group'

vi.mock('@/lib/browser-agent/transport', () => ({
  isBrowserAgentAvailable: () => true,
}))

vi.mock('./tool-permission-card', () => ({
  ToolPermissionCard: () => createElement('div', { 'data-permission-card': true }, 'Allow tool'),
}))

vi.mock('../special-tags', () => ({
  CredentialDisplay: ({ data }: { data: Array<{ name?: string }> }) => data[0]?.name ?? '',
  BrowserTakeoverQuestion: ({ reason, answer }: { reason?: string; answer?: string }) =>
    createElement('div', { 'data-takeover-answer': 'true' }, `${reason}: ${answer}`),
}))

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

describe('AgentGroup main tool summary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => act(() => root.unmount()))

  const render = (items: AgentGroupItem[], isStreaming = true, completedGroupCount = 0) => {
    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Sim',
          items,
          completedGroupCount,
          isStreaming,
          isLaneOpen: isStreaming,
        })
      )
    })
    return container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  }

  const call = (id: string, status: ToolCallStatus, activity?: string): AgentGroupItem => ({
    type: 'tool',
    data: {
      id,
      toolName: 'cli_blocks_get',
      displayTitle: `Reading ${id} configuration`,
      status,
      params: {
        args: ['blocks', 'get', id],
        ...(activity
          ? {
              activity: {
                id: activity,
                title: activity,
                completedTitle: activity
                  .replace(/^Checking/, 'Checked')
                  .replace(/^Testing/, 'Tested')
                  .replace(/^Building/, 'Built'),
              },
            }
          : {}),
      },
    },
  })

  it('preserves intent through omitted updates and completion, and only renames on an explicit update', () => {
    const first = call('Exa', 'success', 'Checking search input requirements')
    const second = call('Start', 'executing')
    const third = call('Function', 'executing')
    const header = render([first, second, third])
    expect(header.textContent).toBe('Checking search input requirements + 1')
    expect(header.querySelectorAll('svg')).toHaveLength(1)
    render([first, call('Start', 'success'), third])
    expect(header.textContent).toBe('Checking search input requirements')
    render([first, call('Start', 'success'), call('Function', 'success')], false)
    expect(header.textContent).toBe('Checked search input requirements')
    const update = call('API', 'executing', 'Testing both API workflows')
    render([first, second, update])
    expect(header.textContent).toBe('Testing both API workflows + 1')
    render([call('Next', 'executing')])
    expect(header.textContent).toBe('Reading Next configuration')
  })

  it('summarizes a completed batch with the additional group count and a flat tool log', () => {
    const items = [
      call('Exa', 'success', 'Checking search inputs'),
      call('Start', 'success', 'Checking start inputs'),
      call('Function', 'success'),
    ]
    const header = render(items, true, 2)
    expect(header.textContent).toBe('Checked start inputs + 1')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    act(() => header.click())
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(1)
    expect(container.textContent).not.toContain('Checked search inputs')
  })

  it.each(['cancelled', 'interrupted', 'skipped', 'rejected'] as const)(
    'does not claim completion for %s activity calls',
    (status) => {
      const header = render([call('Start', status, 'Checking start inputs')], false)
      expect(header.textContent).toBe(
        status === 'rejected' ? 'Failed checking start inputs' : 'Stopped checking start inputs'
      )
    }
  )

  it('does not attribute another activity failure to the representative completed activity', () => {
    const header = render(
      [
        call('Exa', 'error', 'Checking search inputs'),
        call('Start', 'success', 'Checking start inputs'),
      ],
      false,
      2
    )
    expect(header.textContent).toBe('Checked start inputs + 1')
    render(
      [
        call('Exa', 'success', 'Checking search inputs'),
        call('Start', 'error', 'Checking start inputs'),
      ],
      false,
      2
    )
    expect(header.textContent).toBe('Failed checking start inputs + 1')
  })

  it('waits for a complete streamed activity string and retains it when later calls omit activity', () => {
    const streaming = (streamingArgs: string): AgentGroupItem => ({
      type: 'tool',
      data: {
        id: 'streaming',
        toolName: 'sim_cli',
        displayTitle: 'Running CLI command',
        status: 'executing',
        streamingArgs,
      },
    })
    const header = render([streaming('{"activity":{"id":"inputs","title":"Checking')])
    expect(header.textContent).toBe('Working…')
    render([
      streaming(
        '{"activity":{"id":"inputs","title":"Checking search inputs","completedTitle":"Checked search inputs"},"args":['
      ),
    ])
    expect(header.textContent).toBe('Checking search inputs')
    render([
      streaming(
        '{"activity":{"id":"inputs","title":"Checking search inputs","completedTitle":"Checked search inputs"},"args":['
      ),
      call('Exa', 'executing'),
    ])
    expect(header.textContent).toBe('Checking search inputs + 1')
  })

  it('uses current concrete calls and counts down across nested lanes when activity is absent', () => {
    const header = render([
      call('Exa', 'executing'),
      group([call('Start', 'executing'), call('Function', 'executing')]),
    ])
    expect(header.textContent).toBe('Reading Function configuration + 2')
    render([
      call('Exa', 'executing'),
      group([call('Start', 'executing'), call('Function', 'success')]),
    ])
    expect(header.textContent).toBe('Reading Start configuration + 1')
    render([
      call('Exa', 'executing'),
      group([call('Start', 'success'), call('Function', 'success')]),
    ])
    expect(header.textContent).toBe('Reading Exa configuration')
  })

  it('does not let a nested agent rename the parent or treat a resource title as intent', () => {
    const header = render([
      call('Exa', 'executing', 'Checking search inputs'),
      group([call('Start', 'executing', 'Building an unrelated API')]),
    ])
    expect(header.textContent).toBe('Checking search inputs + 1')
    render([
      {
        type: 'tool',
        data: {
          id: 'file',
          toolName: 'cli_files_create',
          displayTitle: 'Creating Report',
          status: 'executing',
          params: { title: 'Report' },
        },
      },
    ])
    expect(header.textContent).toBe('Creating Report')
  })

  it('starts collapsed while streaming, shows the tool and count, and preserves manual expansion', () => {
    const items = [tool('success'), tool('executing')]
    const header = render(items)
    expect(header.textContent).toBe('Searching')
    expect(header.textContent).not.toContain('Sim')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    act(() => header.click())
    expect(header.getAttribute('aria-expanded')).toBe('true')
    render([...items, tool('executing')])
    expect(header.textContent).toBe('Searching + 1')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    act(() => header.click())
    render([...items, tool('executing')])
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it.each(['success', 'error', 'cancelled'] as const)(
    'shows an honest terminal label for %s with no remaining-call count',
    (status) => {
      const header = render([tool('success'), tool(status)], false)
      expect(header.textContent).toBe(
        {
          success: 'Searched',
          error: 'Failed searching',
          cancelled: 'Stopped searching',
        }[status]
      )
      expect(header.getAttribute('aria-expanded')).toBe('false')
    }
  )

  it('keeps nested permission decisions visible even after a manual collapse', () => {
    const header = render([tool('success'), group([tool('awaiting_approval')])])
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-permission-card]')).not.toBeNull()
    act(() => header.click())
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a terminal handoff so the user can unblock it', () => {
    const handoff: AgentGroupItem = {
      type: 'tool',
      data: {
        id: 'terminal-handoff',
        toolName: 'terminal',
        displayTitle: 'Waiting for terminal input',
        status: 'executing',
        params: {
          operation: 'handoff',
          args: { terminalId: 'terminal-1', reason: 'Finish login' },
        },
      },
    }
    const header = render([handoff])
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Finish login')
    render([tool('success')])
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })
})
