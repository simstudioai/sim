/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'

describe('ActivityStream header pacing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function show(label: string, isActive: boolean, activityKey: string) {
    act(() =>
      root.render(
        <ActivityStream
          activity={{ label, isActive, icon: null }}
          activityKey={activityKey}
          attentionKey=''
          collapsible={false}
          expanded={false}
          onToggle={() => {}}
          isStreaming
        >
          {null}
        </ActivityStream>
      )
    )
    return container.textContent
  }

  it("never flashes a finished call's title between a run's calls", () => {
    expect(show('Listing workflows', true, 'call-1')).toBe('Listing workflows')
    act(() => vi.advanceTimersByTime(300))
    expect(show('Listed workflows', false, 'call-1')).toBe('Listing workflows')
    act(() => vi.advanceTimersByTime(300))
    expect(show('Reading run logs', true, 'call-2')).toBe('Listing workflows')
    act(() => vi.advanceTimersByTime(400))
    expect(container.textContent).toBe('Reading run logs')
  })

  it('settles on the finished title once the run stays idle', () => {
    show('Listing workflows', true, 'call-1')
    act(() => vi.advanceTimersByTime(300))
    show('Listed workflows', false, 'call-1')
    act(() => vi.advanceTimersByTime(700))
    expect(container.textContent).toBe('Listed workflows')
  })
})
