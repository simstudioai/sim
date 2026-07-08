/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SaveStatus, useAutosave } from '@/hooks/use-autosave'

interface ProbeProps {
  content: string
  savedContent: string
  onSave: () => Promise<void>
  delay?: number
  enabled?: boolean
}

interface HookHandle {
  status: () => SaveStatus
  isDirty: () => boolean
  saveImmediately: () => Promise<void>
  rerender: (next: Partial<ProbeProps>) => void
  unmount: () => void
}

/**
 * Minimal dependency-free hook harness (the repo has no `@testing-library/react`). Mounts the hook
 * in a real React 19 root under jsdom so effects, refs, and timers run exactly as in the app.
 */
function renderAutosave(initial: ProbeProps): { handle: HookHandle; props: ProbeProps } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  const props = { ...initial }
  let latest = { saveStatus: 'idle' as SaveStatus, isDirty: false, saveImmediately: async () => {} }

  function Probe(p: ProbeProps) {
    latest = useAutosave(p)
    return null
  }

  const render = () => {
    act(() => {
      root.render(<Probe {...props} />)
    })
  }
  render()

  const handle: HookHandle = {
    status: () => latest.saveStatus,
    isDirty: () => latest.isDirty,
    saveImmediately: () => latest.saveImmediately(),
    rerender: (next) => {
      Object.assign(props, next)
      render()
    },
    unmount: () => act(() => root.unmount()),
  }
  return { handle, props }
}

/** Flush pending microtasks (awaited promises) inside an act() boundary. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces edits into a single save after the delay', async () => {
    const onSave = vi.fn(async () => {})
    const { handle, props } = renderAutosave({
      content: 'a',
      savedContent: 'a',
      onSave,
      delay: 1500,
    })
    expect(handle.isDirty()).toBe(false)

    // Three rapid edits within the debounce window.
    handle.rerender({ content: 'ab' })
    act(() => void vi.advanceTimersByTime(500))
    handle.rerender({ content: 'abc' })
    act(() => void vi.advanceTimersByTime(500))
    handle.rerender({ content: 'abcd' })
    expect(handle.isDirty()).toBe(true)
    expect(onSave).not.toHaveBeenCalled()

    // Only after a full quiet delay does exactly one save fire.
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    await flush()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(props.content).toBe('abcd')
  })

  it('holds the "saving" status for the minimum display window, then saved → idle', async () => {
    let resolveSave: (() => void) | undefined
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    const { handle } = renderAutosave({ content: 'a', savedContent: 'a', onSave })

    handle.rerender({ content: 'a1' })
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    await flush()
    expect(handle.status()).toBe('saving')

    // Resolve the network save quickly — status must still read "saving" until the min window.
    await act(async () => {
      resolveSave?.()
    })
    await flush()
    expect(handle.status()).toBe('saving')

    // Simulate the consumer advancing the saved baseline, then cross the min-display floor.
    handle.rerender({ savedContent: 'a1' })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await flush()
    expect(handle.status()).toBe('saved')

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(handle.status()).toBe('idle')
  })

  it('persists the latest content when an edit lands during an in-flight save (no data loss)', async () => {
    const saved: string[] = []
    let resolveSave: (() => void) | undefined
    const { handle, props } = renderAutosave({
      content: 'a',
      savedContent: 'a',
      onSave: () =>
        new Promise<void>((resolve) => {
          saved.push(props.content)
          resolveSave = resolve
        }),
    })

    handle.rerender({ content: 'a1' })
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    await flush()
    expect(saved).toEqual(['a1'])

    // While the PUT is in flight, the user types more.
    handle.rerender({ content: 'a12' })

    // The in-flight save resolves; consumer advances baseline to what was written.
    handle.rerender({ savedContent: 'a1' })
    await act(async () => {
      resolveSave?.()
    })
    await flush()
    // The trailing-resave chain must pick up the newer content after the display window.
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await flush()
    expect(saved).toEqual(['a1', 'a12'])
  })

  it('stops after an error and does not auto-retry', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('boom')
    })
    const { handle } = renderAutosave({ content: 'a', savedContent: 'a', onSave })

    handle.rerender({ content: 'a1' })
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await flush()
    expect(handle.status()).toBe('error')
    expect(onSave).toHaveBeenCalledTimes(1)

    // Content is still dirty but the chain must NOT re-fire on its own.
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flush()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('saveImmediately cancels the debounce and saves now, but no-ops when clean', async () => {
    const onSave = vi.fn(async () => {})
    const { handle } = renderAutosave({ content: 'a', savedContent: 'a', onSave })

    // No-op when nothing is dirty.
    await act(async () => {
      await handle.saveImmediately()
    })
    expect(onSave).not.toHaveBeenCalled()

    // Dirty + Cmd+S saves immediately, before the debounce delay elapses.
    handle.rerender({ content: 'a1' })
    await act(async () => {
      await handle.saveImmediately()
    })
    await flush()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not save while disabled (the streaming lock)', async () => {
    const onSave = vi.fn(async () => {})
    const { handle } = renderAutosave({
      content: 'a',
      savedContent: 'a',
      onSave,
      enabled: false,
    })

    handle.rerender({ content: 'a1' })
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    await flush()
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      await handle.saveImmediately()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('flushes the latest content on unmount when still dirty', async () => {
    const onSave = vi.fn(async () => {})
    const { handle } = renderAutosave({ content: 'a', savedContent: 'a', onSave })

    handle.rerender({ content: 'a1' })
    // Unmount before the debounce fires — the cleanup flush must still persist the edit.
    handle.unmount()
    await flush()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not flush on unmount when the document is clean', async () => {
    const onSave = vi.fn(async () => {})
    const { handle } = renderAutosave({ content: 'a', savedContent: 'a', onSave })
    handle.unmount()
    await flush()
    expect(onSave).not.toHaveBeenCalled()
  })
})
