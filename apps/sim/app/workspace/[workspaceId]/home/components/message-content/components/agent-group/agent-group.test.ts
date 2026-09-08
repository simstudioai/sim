/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { isAgentGroupResolved } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import type { ToolCallData, ToolCallStatus } from '../../../../types'

vi.mock('@/lib/browser-agent/transport', () => ({
  isBrowserAgentAvailable: () => true,
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
          isCurrentSection: true,
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
          isCurrentSection: true,
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
          isCurrentSection: true,
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
