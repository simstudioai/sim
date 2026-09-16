/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalTabIcon } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry/terminal-tab-icon'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

vi.mock('@/components/ui', async () => {
  const { createElement } = await import('react')
  return {
    ThinkingLoader: () => createElement('span', { 'aria-label': 'Thinking' }),
  }
})

let root: Root | null = null
let container: HTMLDivElement | null = null

const SCOPE = 'chat-1'

/** Drives the icon the way the store does: an agent command targeting the shell, and reset epochs. */
function render(active: boolean, resetEpoch = 0): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => {
    useCopilotTerminalStore.setState({
      activeScopeId: SCOPE,
      sessions: {
        [SCOPE]: {
          tabs: { tabs: [], activeTerminalId: null },
          agentCommandTerminalIds: active ? { 'tool-1': '7' } : {},
          activityResetEpoch: resetEpoch,
          suspended: false,
        },
      },
    })
    root?.render(<TerminalTabIcon terminalId='7' scopeId={SCOPE} />)
  })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('TerminalTabIcon', () => {
  it('shows a fast command for at least one second', () => {
    vi.useFakeTimers()

    render(true)
    expect(container?.querySelector('[aria-label="Thinking"]')).not.toBeNull()

    render(false)
    act(() => vi.advanceTimersByTime(999))
    expect(container?.querySelector('[aria-label="Thinking"]')).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(container?.querySelector('[aria-label="Thinking"]')).toBeNull()
  })

  it('bypasses the visibility floor when the activity epoch resets', () => {
    vi.useFakeTimers()

    render(true)
    act(() => vi.advanceTimersByTime(0))
    act(() => vi.advanceTimersByTime(100))
    render(false)
    expect(container?.querySelector('[aria-label="Thinking"]')).not.toBeNull()

    render(false, 1)
    expect(container?.querySelector('[aria-label="Thinking"]')).toBeNull()
  })

  it('keeps the visibility floor when stale cleanup preserves the activity epoch', () => {
    vi.useFakeTimers()

    render(true)
    act(() => vi.advanceTimersByTime(100))
    render(false)
    act(() => vi.advanceTimersByTime(100))

    render(false)
    expect(container?.querySelector('[aria-label="Thinking"]')).not.toBeNull()

    act(() => vi.advanceTimersByTime(800))
    expect(container?.querySelector('[aria-label="Thinking"]')).toBeNull()
  })
})
