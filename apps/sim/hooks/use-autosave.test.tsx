/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// jsdom has no real IndexedDB; fake idb-keyval with an in-memory map so draft persistence is
// deterministic and inspectable without depending on a browser implementation.
const { fakeDraftStore } = vi.hoisted(() => ({ fakeDraftStore: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string) => Promise.resolve(fakeDraftStore.get(key))),
  set: vi.fn((key: string, value: unknown) => {
    fakeDraftStore.set(key, value)
    return Promise.resolve()
  }),
  del: vi.fn((key: string) => {
    fakeDraftStore.delete(key)
    return Promise.resolve()
  }),
}))

import { type SaveStatus, useAutosave } from '@/hooks/use-autosave'

interface ProbeProps {
  content: string
  savedContent: string
  onSave: () => Promise<void>
  delay?: number
  enabled?: boolean
  draftKey?: string
  onRestoreDraft?: (content: string) => void
}

interface HookHandle {
  status: () => SaveStatus
  isDirty: () => boolean
  saveImmediately: () => Promise<void>
  discard: () => void
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
  let latest = {
    saveStatus: 'idle' as SaveStatus,
    isDirty: false,
    saveImmediately: async () => {},
    discard: () => {},
  }

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
    discard: () => latest.discard(),
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
    fakeDraftStore.clear()
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

  it('writes a local backup on unmount even if the network flush fails', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('offline')
    })
    const { handle } = renderAutosave({
      content: 'a',
      savedContent: 'a',
      onSave,
      draftKey: 'file-unmount',
    })

    handle.rerender({ content: 'a1' })
    // Unmount before the 400ms local-draft debounce fires — the pending timer is cancelled, so
    // the cleanup itself must persist the draft, not just attempt (and here, fail) the network flush.
    handle.unmount()
    await flush()
    expect(fakeDraftStore.get('autosave-draft:file-unmount')).toEqual({
      content: 'a1',
      savedContent: 'a',
    })
  })

  it('does not flush on unmount when the document is clean', async () => {
    const onSave = vi.fn(async () => {})
    const { handle } = renderAutosave({ content: 'a', savedContent: 'a', onSave })
    handle.unmount()
    await flush()
    expect(onSave).not.toHaveBeenCalled()
  })

  describe('local draft persistence (draftKey)', () => {
    it('mirrors dirty edits into IndexedDB on a short debounce, independent of the network save', async () => {
      let resolveSave: (() => void) | undefined
      const onSave = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-1',
      })

      handle.rerender({ content: 'a1' })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await flush()
      // The local draft lands well before the (longer) network debounce fires.
      expect(fakeDraftStore.get('autosave-draft:file-1')).toEqual({
        content: 'a1',
        savedContent: 'a',
      })
      expect(onSave).not.toHaveBeenCalled()
      resolveSave?.()
    })

    it('clears the local draft once the network save succeeds and the caller advances savedContent', async () => {
      let resolveSave: (() => void) | undefined
      const onSave = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-2',
      })

      handle.rerender({ content: 'a1' })
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      await flush()
      // The network save is in flight; the local draft is still the only record of the edit.
      expect(fakeDraftStore.has('autosave-draft:file-2')).toBe(true)

      handle.rerender({ savedContent: 'a1' })
      await act(async () => {
        resolveSave?.()
      })
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-2')).toBe(false)
    })

    it('does not clear the local draft when a newer edit lands while the save is in flight', async () => {
      let resolveSave: (() => void) | undefined
      const onSave = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-2b',
      })

      handle.rerender({ content: 'a1' })
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-2b')).toBe(true)

      // A further edit lands while the first save is still in flight.
      handle.rerender({ content: 'a12' })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await flush()

      // The first save resolves; the caller advances savedContent only to the snapshot it saved.
      handle.rerender({ savedContent: 'a1' })
      await act(async () => {
        resolveSave?.()
      })
      await flush()
      // Still dirty ('a12' !== 'a1') — the local backup for the untransmitted edit must survive,
      // even though `save()`'s success no longer explicitly clears it.
      expect(fakeDraftStore.has('autosave-draft:file-2b')).toBe(true)
      expect(fakeDraftStore.get('autosave-draft:file-2b')).toMatchObject({ content: 'a12' })
    })

    it('flushes the draft to IndexedDB when the page becomes hidden', async () => {
      const onSave = vi.fn(async () => {})
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-3',
      })

      handle.rerender({ content: 'a1' })
      // No timers advanced — simulates a tab close mid-keystroke, before either debounce fires.
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
      expect(fakeDraftStore.get('autosave-draft:file-3')).toEqual({
        content: 'a1',
        savedContent: 'a',
      })
    })

    it('restores a draft left behind by a prior session, once, on mount', async () => {
      fakeDraftStore.set('autosave-draft:file-4', { content: 'recovered', savedContent: 'a' })
      const onSave = vi.fn(async () => {})
      const onRestoreDraft = vi.fn()
      renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-4',
        onRestoreDraft,
      })

      await flush()
      expect(onRestoreDraft).toHaveBeenCalledTimes(1)
      expect(onRestoreDraft).toHaveBeenCalledWith('recovered')
    })

    it('does not clobber a fresh edit made while the recovery read was still in flight', async () => {
      fakeDraftStore.set('autosave-draft:file-6', { content: 'recovered', savedContent: 'a' })
      const onSave = vi.fn(async () => {})
      const onRestoreDraft = vi.fn()
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-6',
        onRestoreDraft,
      })

      // The user types before the async IndexedDB read resolves.
      handle.rerender({ content: 'user-typed' })
      await flush()
      expect(onRestoreDraft).not.toHaveBeenCalled()
    })

    it('discards a stale draft instead of restoring it when the server baseline has moved on', async () => {
      fakeDraftStore.set('autosave-draft:file-5', {
        content: 'stale-edit',
        savedContent: 'old-baseline',
      })
      const onSave = vi.fn(async () => {})
      const onRestoreDraft = vi.fn()
      renderAutosave({
        content: 'new-baseline',
        savedContent: 'new-baseline',
        onSave,
        draftKey: 'file-5',
        onRestoreDraft,
      })

      await flush()
      expect(onRestoreDraft).not.toHaveBeenCalled()
    })

    it('discard clears the local draft immediately and blocks any further write, even mid-race with unmount', async () => {
      const onSave = vi.fn(async () => {})
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-discard',
      })

      handle.rerender({ content: 'a1' })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-discard')).toBe(true)

      // Discard fires before the caller's content===savedContent reset has landed — the hook's
      // own flag must block persistence regardless of that race, not just the IndexedDB delete.
      act(() => handle.discard())
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-discard')).toBe(false)

      // Simulate the unmount flush racing in right after discard, while still (from the hook's
      // perspective) dirty: neither the local draft nor the network save must fire.
      handle.unmount()
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-discard')).toBe(false)
      expect(onSave).not.toHaveBeenCalled()
    })

    it('discard prevents a pending debounced network save from firing', async () => {
      const onSave = vi.fn(async () => {})
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-discard-2',
      })

      handle.rerender({ content: 'a1' })
      act(() => handle.discard())

      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      await flush()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('corrects the server once an already-in-flight save lands after discard', async () => {
      let resolveSave: (() => void) | undefined
      const onSave = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-discard-3',
      })

      // A save is genuinely in flight (discardedRef can't stop it — it already started).
      handle.rerender({ content: 'a1' })
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      await flush()
      expect(onSave).toHaveBeenCalledTimes(1)

      // The user discards while that save is still pending, and the caller resets content back
      // to the baseline (mirroring what discardChanges does synchronously right after discard()).
      act(() => handle.discard())
      handle.rerender({ content: 'a' })

      await act(async () => {
        resolveSave?.()
      })
      await flush()
      // The stale in-flight write landed; a second, corrective save pushes the reverted content.
      expect(onSave).toHaveBeenCalledTimes(2)
    })

    it('does not issue a corrective save when discard finds nothing in flight', async () => {
      const onSave = vi.fn(async () => {})
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-discard-4',
      })

      handle.rerender({ content: 'a1' })
      act(() => handle.discard())
      await flush()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('serializes IndexedDB writes and deletes so a slow write cannot resurrect a discarded draft', async () => {
      let resolveWrite: (() => void) | undefined
      const idbKeyval = await import('idb-keyval')
      vi.mocked(idbKeyval.set).mockImplementationOnce(
        (key: string, value: unknown) =>
          new Promise<void>((resolve) => {
            resolveWrite = () => {
              fakeDraftStore.set(key, value)
              resolve()
            }
          })
      )
      const onSave = vi.fn(async () => {})
      const { handle } = renderAutosave({
        content: 'a',
        savedContent: 'a',
        onSave,
        draftKey: 'file-race',
      })

      handle.rerender({ content: 'a1' })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await flush()
      // The write is now in flight (not yet resolved) when discard's delete is queued behind it.
      act(() => handle.discard())
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-race')).toBe(false)

      // The slow write finally resolves — it must not resurrect the entry the queued delete removed.
      resolveWrite?.()
      await flush()
      expect(fakeDraftStore.has('autosave-draft:file-race')).toBe(false)
    })
  })
})
