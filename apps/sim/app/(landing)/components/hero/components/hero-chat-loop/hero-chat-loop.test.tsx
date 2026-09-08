/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HeroChatLoop,
  type HeroChatPhase,
} from '@/app/(landing)/components/hero/components/hero-chat-loop/hero-chat-loop'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

interface AgentGroupProps {
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isStreaming?: boolean
  isLaneOpen?: boolean
}

const { renderAgentGroup, renderPendingIndicator } = vi.hoisted(() => ({
  renderAgentGroup: vi.fn<(props: AgentGroupProps) => void>(),
  renderPendingIndicator: vi.fn<(props: { label: string }) => void>(),
}))

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
  Button: ({ children }: { children: ReactNode }) => <button type='button'>{children}</button>,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => children,
    Trigger: ({ children }: { children: ReactNode }) => children,
    Content: () => null,
  },
}))
vi.mock('@sim/emcn/icons', () => ({
  Workflow: () => null,
  Mic: () => null,
  Paperclip: () => null,
  Plus: () => null,
  Slash: () => null,
  X: () => null,
}))
vi.mock('@/app/(landing)/components/hero/components/hero-chat-welcome', () => ({
  HeroChatWelcome: () => null,
}))
vi.mock('@/app/(landing)/components/hero/components/hero-platform-loop/sidebar-hotspots', () => ({
  HERO_TOOLTIP_OFFSET: 8,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view',
  () => ({
    AgentGroupView: (props: AgentGroupProps) => {
      renderAgentGroup(props)
      return <section aria-label={props.agentLabel}>{props.agentLabel}</section>
    },
  })
)
vi.mock('@/app/(landing)/components/hero/components/hero-chat-loop/hero-tool-call-item', () => ({
  HeroToolCallItem: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/pending-tag-indicator',
  () => ({
    PendingTagIndicator: (props: { label: string }) => {
      renderPendingIndicator(props)
      return <output>{props.label}</output>
    },
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/question',
  () => ({
    parseQuestionAnswerMessage: () => undefined,
    QuestionDisplay: () => <p>What would you like to do next?</p>,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/send-button/send-button',
  () => ({ SendButton: () => null })
)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderPhase(phase: HeroChatPhase) {
  act(() => {
    root.render(
      <HeroChatLoop
        phase={phase}
        fading={false}
        userMessage='Enrich new leads and post to #sales.'
        replyMessage='The workflow is ready to test with a sample lead.'
        composerValue=''
        isSending={phase !== 'reply'}
        onComposerValueChange={vi.fn()}
        onOpenWorkflowResource={vi.fn()}
        onFollowUpSelect={vi.fn()}
        onSubmit={vi.fn()}
        onStopGeneration={vi.fn()}
      />
    )
  })
}

function hasExecutingTool(items: AgentGroupItem[]): boolean {
  return items.some((item) => item.type === 'tool' && item.data.status === ToolCallStatus.executing)
}

describe('HeroChatLoop production thinking handoff', () => {
  it('shows the submitted prompt before assistant activity begins', () => {
    renderPhase('user')

    expect(host.textContent).toContain('Enrich new leads and post to #sales.')
    expect(host.querySelector('output')).toBeNull()
    expect(renderAgentGroup).not.toHaveBeenCalled()
    expect(renderPendingIndicator).not.toHaveBeenCalled()
  })

  it.each([
    ['thinking', 'Thinking…'],
    ['dispatching', 'Dispatching…'],
  ] as const)('shows the production activity indicator alone during %s', (phase, label) => {
    renderPhase(phase)

    expect(host.querySelector('[data-chat-phase]')?.getAttribute('data-chat-phase')).toBe(phase)
    expect(host.textContent).toContain('Enrich new leads and post to #sales.')
    expect(host.querySelector('output')?.textContent).toBe(label)
    expect(renderPendingIndicator).toHaveBeenLastCalledWith({ label })
    expect(renderAgentGroup).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('The workflow is ready')
  })

  it('keeps the activity indicator mounted while thinking hands off to dispatching', () => {
    renderPhase('thinking')
    const indicator = host.querySelector('output')
    expect(indicator).not.toBeNull()

    renderPhase('dispatching')

    expect(host.querySelector('output')).toBe(indicator)
    expect(indicator?.textContent).toBe('Dispatching…')
    expect(renderAgentGroup).not.toHaveBeenCalled()
  })

  it('replaces the turn loader with Workflow Agent activity only once building begins', () => {
    renderPhase('thinking')
    renderPhase('dispatching')
    renderPhase('building')

    expect(host.querySelector('output')).toBeNull()
    expect(host.querySelectorAll('section')).toHaveLength(1)
    const props = renderAgentGroup.mock.lastCall?.[0]
    expect(props).toMatchObject({
      agentName: 'workflow',
      agentLabel: 'Workflow Agent',
      isStreaming: true,
      isLaneOpen: true,
    })
    expect(props && hasExecutingTool(props.items)).toBe(true)
    expect(host.textContent).not.toContain('The workflow is ready')
  })

  it('shows completed agent groups and the response after building finishes', () => {
    renderPhase('reply')

    expect(host.querySelector('output')).toBeNull()
    expect(Array.from(host.querySelectorAll('section'), (group) => group.textContent)).toEqual([
      'Workflow Agent',
      'Sim',
    ])
    const groups = renderAgentGroup.mock.calls.map(([props]) => props)
    expect(groups.every((group) => !group.isStreaming && !hasExecutingTool(group.items))).toBe(true)
    expect(host.textContent).toContain('The workflow is ready to test with a sample lead.')
    expect(host.textContent).toContain('What would you like to do next?')
  })
  it('reveals the reply before showing follow-up actions when motion is enabled', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    renderPhase('reply')
    expect(host.textContent).not.toContain('The workflow is ready')
    expect(host.textContent).not.toContain('What would you like to do next?')

    act(() => vi.advanceTimersByTime(110))
    expect(host.textContent).toContain('The workflow')
    expect(host.textContent).not.toContain('The workflow is ready to test with a sample lead.')

    act(() => vi.advanceTimersByTime(1000))
    expect(host.textContent).toContain('The workflow is ready to test with a sample lead.')
    expect(host.textContent).toContain('What would you like to do next?')
  })
})
