/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityStatusProps } from '@/components/ui/activity-status'
import { usePacedActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'

describe('usePacedActivity', () => {
  let root: Root
  let shown: ActivityStatusProps | undefined

  function Harness({
    label,
    isActive,
    callId,
    placeholder,
  }: {
    label: string
    isActive: boolean
    callId: string
    placeholder: boolean
  }) {
    shown = usePacedActivity({ label, isActive, icon: null }, callId, 'reset', false, placeholder)
    return null
  }

  function show(label: string, isActive: boolean, callId: string, placeholder = false) {
    act(() =>
      root.render(
        <Harness label={label} isActive={isActive} callId={callId} placeholder={placeholder} />
      )
    )
    return shown?.label
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    root = createRoot(document.createElement('div'))
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  it("never shows a finished call's title between a run's calls", () => {
    expect(show('Listing workflows', true, 'call-1')).toBe('Listing workflows')
    act(() => vi.advanceTimersByTime(300))
    expect(show('Listed workflows', false, 'call-1')).toBe('Listing workflows')
    expect(shown?.isActive).toBe(false)
    act(() => vi.advanceTimersByTime(300))
    expect(show('Reading run logs', true, 'call-2')).toBe('Listing workflows')
    act(() => vi.advanceTimersByTime(400))
    expect(shown?.label).toBe('Reading run logs')
  })

  it('settles on the finished title once the run stays idle', () => {
    show('Listing workflows', true, 'call-1')
    act(() => vi.advanceTimersByTime(300))
    show('Listed workflows', false, 'call-1')
    act(() => vi.advanceTimersByTime(700))
    expect(shown?.label).toBe('Listed workflows')
  })

  it("replaces a placeholder with the call's title as soon as it streams", () => {
    expect(show('Thinking', true, 'call-1', true)).toBe('Thinking')
    act(() => vi.advanceTimersByTime(100))
    expect(show('Looking up the failed run', true, 'call-1')).toBe('Looking up the failed run')
  })

  it('holds a title that matched its placeholder text once the call names itself', () => {
    show('Reading Gauge', true, 'call-1', true)
    act(() => vi.advanceTimersByTime(100))
    expect(show('Reading Gauge', true, 'call-1')).toBe('Reading Gauge')
    act(() => vi.advanceTimersByTime(300))
    expect(show('Read Gauge', false, 'call-1')).toBe('Reading Gauge')
    act(() => vi.advanceTimersByTime(700))
    expect(shown?.label).toBe('Read Gauge')
  })
})
