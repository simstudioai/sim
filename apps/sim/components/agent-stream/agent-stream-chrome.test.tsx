/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/lib/copilot/tools/tool-display', () => ({
  humanizeToolName: (name: string) => name,
}))

vi.mock('@/components/ui', () => ({
  ShimmerText: ({
    as: Comp = 'span',
    children,
    className,
    ...props
  }: {
    as?: 'span' | 'div'
    children: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => {
    const Tag = Comp
    return (
      <Tag data-shimmer='true' className={className} {...props}>
        {children}
      </Tag>
    )
  },
}))

import {
  AgentStreamThinkingChrome,
  type AgentStreamToolCall,
  AgentStreamToolCallsChrome,
} from '@/components/agent-stream/agent-stream-chrome'

function renderChrome(props: { thinking: string; isStreaming?: boolean }): {
  container: HTMLDivElement
  rerender: (next: { thinking: string; isStreaming?: boolean }) => void
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  const mount = (p: { thinking: string; isStreaming?: boolean }) => {
    act(() => {
      root.render(<AgentStreamThinkingChrome thinking={p.thinking} isStreaming={p.isStreaming} />)
    })
  }

  mount(props)

  return {
    container,
    rerender: (next) => mount(next),
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('AgentStreamThinkingChrome', () => {
  const mounts: Array<() => void> = []

  afterEach(() => {
    while (mounts.length) {
      mounts.pop()?.()
    }
  })

  it('opens while streaming with Thinking… label and scrollable body', () => {
    const { container, unmount } = renderChrome({
      thinking: 'step one',
      isStreaming: true,
    })
    mounts.push(unmount)

    const toggle = container.querySelector(
      '[data-testid="agent-stream-thinking-toggle"]'
    ) as HTMLButtonElement
    const body = container.querySelector(
      '[data-testid="agent-stream-thinking-body"]'
    ) as HTMLDivElement

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('Thinking…')
    expect(
      container
        .querySelector('[data-testid="agent-stream-thinking-label"]')
        ?.getAttribute('data-shimmer')
    ).toBe('true')
    expect(body.className).toContain('max-h-40')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.getAttribute('data-shimmer')).toBeNull()
    expect(
      container
        .querySelector('[data-testid="agent-stream-thinking-shimmer"]')
        ?.getAttribute('data-shimmer')
    ).toBe('true')
    expect(body.textContent).toContain('step one')
  })

  it('auto-collapses when streaming ends and shows Thought for a moment', () => {
    const { container, rerender, unmount } = renderChrome({
      thinking: 'long internal chain',
      isStreaming: true,
    })
    mounts.push(unmount)

    rerender({ thinking: 'long internal chain', isStreaming: false })

    const toggle = container.querySelector(
      '[data-testid="agent-stream-thinking-toggle"]'
    ) as HTMLButtonElement
    const body = container.querySelector(
      '[data-testid="agent-stream-thinking-body"]'
    ) as HTMLDivElement

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Thought for a moment')
    expect(
      container
        .querySelector('[data-testid="agent-stream-thinking-label"]')
        ?.getAttribute('data-shimmer')
    ).toBeNull()
    expect(container.querySelector('[data-testid="agent-stream-thinking-shimmer"]')).toBeNull()
    expect(body.className).toContain('text-[var(--text-muted)]')
  })

  it('stays open after manual reopen once collapsed', () => {
    const { container, rerender, unmount } = renderChrome({
      thinking: 'reason\n'.repeat(40),
      isStreaming: true,
    })
    mounts.push(unmount)

    rerender({ thinking: 'reason\n'.repeat(40), isStreaming: false })

    const toggle = container.querySelector(
      '[data-testid="agent-stream-thinking-toggle"]'
    ) as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    const body = container.querySelector(
      '[data-testid="agent-stream-thinking-body"]'
    ) as HTMLDivElement
    Object.defineProperty(body, 'scrollTop', { value: 80, writable: true, configurable: true })

    act(() => {
      toggle.click()
    })

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(body.scrollTop).toBe(0)
    expect(body.textContent).toContain('reason')

    // Re-render with same done state should not force-close a user pin.
    rerender({ thinking: 'reason\n'.repeat(40), isStreaming: false })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('re-opens when a new streaming phase starts', () => {
    const { container, rerender, unmount } = renderChrome({
      thinking: 'first',
      isStreaming: false,
    })
    mounts.push(unmount)

    const toggle = container.querySelector(
      '[data-testid="agent-stream-thinking-toggle"]'
    ) as HTMLButtonElement
    // Initial non-streaming starts closed.
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    rerender({ thinking: 'first then more', isStreaming: true })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('Thinking…')
  })
})

const sampleTools: AgentStreamToolCall[] = [
  {
    key: 'agent-1:t1',
    id: 't1',
    name: 'http_request',
    displayName: 'Http Request',
    status: 'success',
  },
]

function renderToolsChrome(props: { toolCalls?: AgentStreamToolCall[]; isStreaming?: boolean }): {
  container: HTMLDivElement
  rerender: (next: { toolCalls?: AgentStreamToolCall[]; isStreaming?: boolean }) => void
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  const mount = (p: { toolCalls?: AgentStreamToolCall[]; isStreaming?: boolean }) => {
    act(() => {
      root.render(
        <AgentStreamToolCallsChrome
          toolCalls={p.toolCalls ?? sampleTools}
          isStreaming={p.isStreaming}
        />
      )
    })
  }

  mount(props)

  return {
    container,
    rerender: (next) => mount(next),
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('AgentStreamToolCallsChrome', () => {
  const mounts: Array<() => void> = []

  afterEach(() => {
    while (mounts.length) {
      mounts.pop()?.()
    }
  })

  it('opens while tools are streaming and auto-collapses when they finish', () => {
    const { container, rerender, unmount } = renderToolsChrome({
      isStreaming: true,
      toolCalls: [{ ...sampleTools[0], status: 'running' }],
    })
    mounts.push(unmount)

    const toggle = container.querySelector(
      '[data-testid="agent-stream-tools-toggle"]'
    ) as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('Using tools…')
    expect(container.textContent).toContain('Http Request')

    rerender({ isStreaming: false, toolCalls: sampleTools })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Tools')
    expect(container.textContent).not.toContain('Http Request')
  })

  it('stays open after manual reopen once collapsed', () => {
    const { container, rerender, unmount } = renderToolsChrome({ isStreaming: true })
    mounts.push(unmount)

    rerender({ isStreaming: false })

    const toggle = container.querySelector(
      '[data-testid="agent-stream-tools-toggle"]'
    ) as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      toggle.click()
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Http Request')

    rerender({ isStreaming: false })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})
