/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SPRING_LOAD_DELAY_MS,
  type SpringLoadedFolder,
  type SpringOpenOptions,
  useSpringLoadedFolder,
} from '@/app/workspace/[workspaceId]/components/folders/use-spring-loaded-folder'

const mountedRoots: Root[] = []

interface SpringLoadHarness {
  get: () => SpringLoadedFolder
  /** Re-renders the probe with a new inline callback, as a parent re-render would. */
  rerender: () => void
}

function renderSpringLoad(
  onSpringOpen: (folderId: string, options: SpringOpenOptions) => void
): SpringLoadHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)
  let result: SpringLoadedFolder | undefined

  function Probe() {
    // A fresh arrow each render, mirroring how every real consumer passes this.
    result = useSpringLoadedFolder({
      onSpringOpen: (folderId, options) => onSpringOpen(folderId, options),
    })
    return null
  }

  const render = () => {
    act(() => {
      root.render(<Probe />)
    })
  }

  render()

  return {
    get: () => {
      if (!result) throw new Error('Hook result is not ready')
      return result
    },
    rerender: render,
  }
}

/** Advances past the spring delay, flushing the timer callback inside React's act scope. */
function rest(ms = SPRING_LOAD_DELAY_MS) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  vi.useRealTimers()
})

describe('useSpringLoadedFolder', () => {
  it('opens the folder after the drag rests on it', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    rest(SPRING_LOAD_DELAY_MS - 1)
    expect(onSpringOpen).not.toHaveBeenCalled()

    rest(1)
    expect(onSpringOpen).toHaveBeenCalledExactlyOnceWith('folder-a', { history: 'push' })
  })

  it('does not restart the countdown while the drag stays on one folder', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    // `dragover` fires continuously; re-arming the same folder must not push the deadline back.
    act(() => harness.get().arm('folder-a'))
    rest(SPRING_LOAD_DELAY_MS - 100)
    act(() => harness.get().arm('folder-a'))
    rest(100)

    expect(onSpringOpen).toHaveBeenCalledExactlyOnceWith('folder-a', { history: 'push' })
  })

  it('restarts the countdown when the drag moves to another folder', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    rest(SPRING_LOAD_DELAY_MS - 100)
    act(() => harness.get().arm('folder-b'))
    rest(100)
    expect(onSpringOpen).not.toHaveBeenCalled()

    rest()
    expect(onSpringOpen).toHaveBeenCalledExactlyOnceWith('folder-b', { history: 'push' })
  })

  it('cancels the pending open when the drag leaves the row', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    act(() => harness.get().disarm())
    rest()

    expect(onSpringOpen).not.toHaveBeenCalled()
  })

  it('opens a folder again when the drag comes back to it', () => {
    // Descend, walk back out through the breadcrumb, change your mind and descend again — one
    // gesture, and the second entry has to work. Re-entry costs another full delay, and
    // `useSpringNavigation` refuses the folder already on screen, so nothing oscillates.
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    rest()
    act(() => harness.get().arm(null))
    rest()
    act(() => harness.get().arm('folder-a'))
    rest()

    expect(onSpringOpen.mock.calls).toEqual([
      ['folder-a', { history: 'push' }],
      [null, { history: 'replace' }],
      ['folder-a', { history: 'replace' }],
    ])
  })

  it('pushes the first spring-open of a drag and replaces the rest', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    rest()
    act(() => harness.get().arm('folder-b'))
    rest()

    // One gesture, one back-stack entry: Back returns to where the drag started rather than
    // replaying every level it passed through, and without eating the entry it started on.
    expect(onSpringOpen.mock.calls).toEqual([
      ['folder-a', { history: 'push' }],
      ['folder-b', { history: 'replace' }],
    ])

    // A new drag is a new gesture, so its first open pushes again.
    act(() => harness.get().reset())
    act(() => harness.get().arm('folder-c'))
    rest()
    expect(onSpringOpen).toHaveBeenLastCalledWith('folder-c', { history: 'push' })
  })

  it('keeps a stable handle identity across renders', () => {
    // Regression guard: consumers feed this handle into a `useCallback` that a drag-lifecycle
    // effect depends on. A fresh object per render re-runs that effect continuously, which tore
    // down in-flight drags and silently disabled spring-loading entirely.
    const harness = renderSpringLoad(vi.fn())

    const before = harness.get()
    harness.rerender()
    harness.rerender()

    expect(harness.get()).toBe(before)
  })

  it('allows the same folder again after the drag ends', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    rest()
    act(() => harness.get().reset())

    act(() => harness.get().arm('folder-a'))
    rest()
    expect(onSpringOpen).toHaveBeenCalledTimes(2)
  })

  it('springs to the workspace root, which a breadcrumb targets as null', () => {
    // Walking a drag back UP goes through the breadcrumb, whose first crumb is the root — so
    // null has to be a real destination here, distinct from "nothing armed".
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm(null))
    rest()

    expect(onSpringOpen).toHaveBeenCalledExactlyOnceWith(null, { history: 'push' })
  })

  it('re-opens the root like any other folder, and only after a full rest', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm(null))
    rest()

    // Passing over another row cancels the countdown, so returning to the root has to wait out
    // the delay again rather than firing on whatever was left of the previous one.
    act(() => harness.get().arm('folder-a'))
    act(() => harness.get().arm(null))
    expect(onSpringOpen).toHaveBeenCalledTimes(1)
    rest()

    expect(onSpringOpen).toHaveBeenCalledTimes(2)
  })

  it('never opens a folder after unmount', () => {
    const onSpringOpen = vi.fn()
    const harness = renderSpringLoad(onSpringOpen)

    act(() => harness.get().arm('folder-a'))
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount()
    })
    rest()

    expect(onSpringOpen).not.toHaveBeenCalled()
  })
})
