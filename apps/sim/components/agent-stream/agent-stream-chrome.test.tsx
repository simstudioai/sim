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

import { AgentStreamThinkingChrome } from '@/components/agent-stream/agent-stream-chrome'

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
    expect(body.className).toContain('max-h-40')
    expect(body.className).toContain('overflow-y-auto')
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

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Thought for a moment')
  })

  it('stays open after manual reopen once collapsed', () => {
    const { container, rerender, unmount } = renderChrome({
      thinking: 'reason',
      isStreaming: true,
    })
    mounts.push(unmount)

    rerender({ thinking: 'reason', isStreaming: false })

    const toggle = container.querySelector(
      '[data-testid="agent-stream-thinking-toggle"]'
    ) as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      toggle.click()
    })

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(
      container.querySelector('[data-testid="agent-stream-thinking-body"]')?.textContent
    ).toContain('reason')

    // Re-render with same done state should not force-close a user pin.
    rerender({ thinking: 'reason', isStreaming: false })
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
