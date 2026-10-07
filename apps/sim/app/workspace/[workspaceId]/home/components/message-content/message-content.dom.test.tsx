/**
 * @vitest-environment jsdom
 *
 * The turn's wait indicator: Thinking from send, plus elapsed time once a silent wait runs long.
 */

import { act } from 'react'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => authClientMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => ({}),
}))

import { ELAPSED_VISIBLE_AFTER_MS } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/pending-tag-indicator'
import { MessageContent } from '@/app/workspace/[workspaceId]/home/components/message-content/message-content'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

const THINKING_BLOCK: ContentBlock = {
  type: 'thinking',
  content: 'Weighing the options',
  timestamp: 1,
}
const TEXT_BLOCK: ContentBlock = { type: 'text', content: 'Here is the plan.', timestamp: 2 }
const RUNNING_TOOL_BLOCK: ContentBlock = {
  type: 'tool_call',
  toolCall: { id: 'tool-1', name: 'grep', status: 'executing' },
  timestamp: 2,
}
const STOPPED_BLOCK: ContentBlock = { type: 'stopped', timestamp: 3 }

let container: HTMLDivElement
let root: Root

function renderTurn(blocks: ContentBlock[], isStreaming: boolean) {
  act(() => {
    root.render(
      <MessageContent blocks={blocks} fallbackContent='' isStreaming={isStreaming} isLast />
    )
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** The elapsed count is the only `aria-hidden` span whose text is a duration. */
function elapsedText(): string | null {
  const spans = container.querySelectorAll('span[aria-hidden="true"]')
  for (const span of spans) {
    if (/^\d+(m \d+)?s$/.test(span.textContent ?? '')) return span.textContent
  }
  return null
}

function isThinkingShown(): boolean {
  return container.querySelector('output')?.closest('[aria-hidden="false"]') !== null
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Reduced motion: the loader holds one shape instead of running its morph
  // clock, so the timer count below is the wait indicator's alone.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  vi.useFakeTimers()
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

describe('turn wait indicator', () => {
  it('shows Thinking at send and adds the elapsed time once the wait runs long', () => {
    renderTurn([], true)

    expect(isThinkingShown()).toBe(true)
    expect(container.textContent).toContain('Thinking')
    expect(elapsedText()).toBeNull()

    advance(ELAPSED_VISIBLE_AFTER_MS - 1_000)
    expect(elapsedText()).toBeNull()

    advance(1_000)
    expect(elapsedText()).toBe('5s')

    advance(7_000)
    expect(elapsedText()).toBe('12s')
  })

  it('keeps counting through hidden reasoning, which is not visible output', () => {
    renderTurn([], true)
    advance(6_000)

    renderTurn([THINKING_BLOCK], true)
    advance(1_000)

    expect(isThinkingShown()).toBe(true)
    expect(elapsedText()).toBe('7s')
  })

  it('hides the indicator and its count when the first output arrives', () => {
    renderTurn([], true)
    advance(8_000)
    expect(elapsedText()).toBe('8s')

    renderTurn([THINKING_BLOCK, TEXT_BLOCK], true)

    expect(isThinkingShown()).toBe(false)
    expect(elapsedText()).toBeNull()
  })

  it('does not count while a running tool row owns the wait', () => {
    renderTurn([RUNNING_TOOL_BLOCK], true)
    advance(10_000)

    expect(isThinkingShown()).toBe(false)
    expect(elapsedText()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes the indicator and stops ticking when the turn ends without output', () => {
    renderTurn([], true)
    advance(8_000)

    renderTurn([], false)

    expect(container.querySelector('output')).toBeNull()
    expect(elapsedText()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes the indicator and stops ticking when the user stops the turn', () => {
    renderTurn([], true)
    advance(8_000)

    renderTurn([STOPPED_BLOCK], true)

    expect(container.querySelector('output')).toBeNull()
    expect(container.textContent).toContain('Stopped by user')
    expect(elapsedText()).toBeNull()
  })

  it('clears its clock on unmount', () => {
    renderTurn([], true)
    advance(8_000)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    act(() => root.unmount())
    root = createRoot(container)

    expect(vi.getTimerCount()).toBe(0)
  })
})
