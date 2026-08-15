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
