/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPRING_LOAD_DELAY_MS } from '@/app/workspace/[workspaceId]/components/folders/use-spring-loaded-folder'
import {
  type SpringNavigation,
  useSpringNavigation,
} from '@/app/workspace/[workspaceId]/components/folders/use-spring-navigation'

const mountedRoots: Root[] = []

/**
 * Drives the hook the way a drag does, re-rendering with the folder the navigation callback
 * just moved to — the hook compares the origin against the *current* folder, so a probe that
 * never advances would never exercise the return path.
 */
function renderSpringNavigation(startFolderId: string | null) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)

  const navigate = vi.fn<(folderId: string | null, history: 'push' | 'replace') => void>()
  let currentFolderId = startFolderId
  let result: SpringNavigation | undefined

  function Probe({ folderId }: { folderId: string | null }) {
    result = useSpringNavigation({
      currentFolderId: folderId,
      onNavigate: (nextFolderId, options) => {
        navigate(nextFolderId, options.history)
        currentFolderId = nextFolderId
      },
    })
    return null
  }

  const render = () => {
    act(() => {
      root.render(<Probe folderId={currentFolderId} />)
    })
  }

  render()

  return {
    get: () => {
      if (!result) throw new Error('Hook result is not ready')
      return result
    },
    rerender: render,
    navigate,
    currentFolderId: () => currentFolderId,
  }
}

/**
 * Advances past the spring delay, then re-renders with the folder the navigation moved to —
 * the real list does the same, and the hook compares the origin against the *current* folder,
 * so a probe stuck on the old one would never exercise the return path.
 */
function rest(harness: { rerender: () => void }) {
  act(() => {
    vi.advanceTimersByTime(SPRING_LOAD_DELAY_MS)
  })
  harness.rerender()
}

/** One spring-open: rest the drag on `folderId` until the timer fires and the list follows. */
function descend(nav: ReturnType<typeof renderSpringNavigation>, folderId: string | null) {
  act(() => nav.get().arm(folderId))
  rest(nav)
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

describe('useSpringNavigation', () => {
  it('opens a folder the drag rests on', () => {
    const nav = renderSpringNavigation(null)

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-a'))
    rest(nav)

    expect(nav.navigate).toHaveBeenCalledExactlyOnceWith('folder-a', 'push')
  })

  it('returns to the origin when the drag ends without a drop', () => {
    // The whole point: spring-loading only goes deeper, so a cancelled drag would otherwise
    // strand the user in a folder they never chose to open.
    const nav = renderSpringNavigation(null)

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-a'))
    rest(nav)
    act(() => nav.get().end())

    expect(nav.navigate).toHaveBeenLastCalledWith(null, 'replace')
    expect(nav.currentFolderId()).toBeNull()
  })

  it('stays put when a drop actually landed', () => {
    const nav = renderSpringNavigation(null)

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-a'))
    rest(nav)
    act(() => nav.get().markDropHandled())
    act(() => nav.get().end())

    expect(nav.navigate).toHaveBeenCalledExactlyOnceWith('folder-a', 'push')
    expect(nav.currentFolderId()).toBe('folder-a')
  })

  it('returns in one hop from several levels deep', () => {
    const nav = renderSpringNavigation(null)

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-a'))
    rest(nav)
    act(() => nav.get().arm('folder-b'))
    rest(nav)
    act(() => nav.get().end())

    expect(nav.navigate.mock.calls).toEqual([
      ['folder-a', 'push'],
      ['folder-b', 'replace'],
      [null, 'replace'],
    ])
    expect(nav.currentFolderId()).toBeNull()
  })

  it('returns to a subfolder origin, not the root', () => {
    const nav = renderSpringNavigation('origin-folder')

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-a'))
    rest(nav)
    act(() => nav.get().end())

    expect(nav.currentFolderId()).toBe('origin-folder')
  })

  it('does not navigate when the drag never opened anything', () => {
    const nav = renderSpringNavigation('origin-folder')

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().end())

    expect(nav.navigate).not.toHaveBeenCalled()
  })

  describe('walking a drag back out and in again', () => {
    it('re-enters a folder it already left through the breadcrumb', () => {
      // The whole point of the breadcrumb accepting a drag: descend, think better of it, walk
      // back up, then descend again — all inside one gesture without releasing the mouse.
      const nav = renderSpringNavigation(null)

      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-a')
      expect(nav.currentFolderId()).toBe('folder-a')

      descend(nav, null)
      expect(nav.currentFolderId()).toBeNull()

      descend(nav, 'folder-a')
      expect(nav.currentFolderId()).toBe('folder-a')

      expect(nav.navigate.mock.calls).toEqual([
        ['folder-a', 'push'],
        [null, 'replace'],
        ['folder-a', 'replace'],
      ])
    })

    it('never re-opens the folder already on screen', () => {
      // The crumb for the current folder is a legal drop target but not a navigation. Arming it
      // would re-enter the folder the drag is already standing in, on a loop.
      const nav = renderSpringNavigation(null)

      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-a')

      descend(nav, 'folder-a')

      expect(nav.navigate).toHaveBeenCalledExactlyOnceWith('folder-a', 'push')
    })

    it('cancels a pending open when the drag moves onto the current folder', () => {
      // Hovering a sibling folder starts its countdown; sliding onto the crumb of the folder
      // you are already in has to call that off, not let it fire from under the cursor.
      const nav = renderSpringNavigation('folder-a')

      act(() => nav.get().rememberOrigin())
      act(() => nav.get().arm('folder-b'))
      act(() => {
        vi.advanceTimersByTime(SPRING_LOAD_DELAY_MS - 1)
      })
      descend(nav, 'folder-a')

      expect(nav.navigate).not.toHaveBeenCalled()
    })

    it('returns to the origin in one hop after a round trip that dropped nothing', () => {
      const nav = renderSpringNavigation('origin')

      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-a')
      descend(nav, 'folder-b')
      descend(nav, 'folder-a')

      nav.navigate.mockClear()
      act(() => nav.get().end())

      expect(nav.navigate).toHaveBeenCalledExactlyOnceWith('origin', 'replace')
      expect(nav.currentFolderId()).toBe('origin')
    })

    it('stays put when the round trip ends in a real drop', () => {
      const nav = renderSpringNavigation('origin')

      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-a')
      descend(nav, null)
      descend(nav, 'folder-a')

      nav.navigate.mockClear()
      act(() => {
        nav.get().markDropHandled()
        nav.get().end()
      })

      expect(nav.navigate).not.toHaveBeenCalled()
      expect(nav.currentFolderId()).toBe('folder-a')
    })

    it('walks back to the origin folder itself without then bouncing away from it', () => {
      // Ending a drag whose spring-opens happen to land back on the origin must not navigate
      // again — the guard is origin-vs-current, not "did anything open".
      const nav = renderSpringNavigation('origin')

      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-a')
      descend(nav, 'origin')
      expect(nav.currentFolderId()).toBe('origin')

      nav.navigate.mockClear()
      act(() => nav.get().end())

      expect(nav.navigate).not.toHaveBeenCalled()
    })

    it('starts the next drag from where the previous one left the user', () => {
      // A drag that ended on a new folder is the new origin. Reusing the old one would yank the
      // list back several folders on the next unrelated drag.
      const nav = renderSpringNavigation('origin')

      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-a')
      act(() => {
        nav.get().markDropHandled()
        nav.get().end()
      })

      nav.navigate.mockClear()
      act(() => nav.get().rememberOrigin())
      descend(nav, 'folder-b')
      act(() => nav.get().end())

      expect(nav.navigate.mock.calls).toEqual([
        ['folder-b', 'push'],
        ['folder-a', 'replace'],
      ])
    })
  })

  it('does not carry drop state into the next drag', () => {
    const nav = renderSpringNavigation(null)

    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-a'))
    rest(nav)
    act(() => nav.get().markDropHandled())
    act(() => nav.get().end())
    nav.navigate.mockClear()

    // A second drag that lands nowhere must still return, despite the first one having dropped.
    act(() => nav.get().rememberOrigin())
    act(() => nav.get().arm('folder-b'))
    rest(nav)
    act(() => nav.get().end())

    expect(nav.navigate.mock.calls).toEqual([
      ['folder-b', 'push'],
      ['folder-a', 'replace'],
    ])
  })
})
