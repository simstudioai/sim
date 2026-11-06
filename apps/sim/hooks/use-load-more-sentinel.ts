'use client'

import { useCallback } from 'react'

interface UseLoadMoreSentinelOptions {
  /** Loads the next page; absent means the list has no further pages to request. */
  onLoadMore: (() => void) | undefined
  /** Whether reaching the sentinel should load more right now. */
  enabled: boolean
  /**
   * Ask only once the sentinel comes back into view, not because it already is — after a failed
   * load, so a rebuilt observer does not retry a failing request on its own, in a loop.
   */
  waitForReentry?: boolean
}

/**
 * A callback ref for the element at the end of a paged list: `onLoadMore` runs when it scrolls
 * within 200px of view, while `enabled`. Pass `enabled: false` during a fetch, so the
 * observer is rebuilt when the fetch ends and fires again if the sentinel is still in view —
 * unless `waitForReentry`, when it fires only after the sentinel leaves view and returns.
 */
export function useLoadMoreSentinel({
  onLoadMore,
  enabled,
  waitForReentry = false,
}: UseLoadMoreSentinelOptions) {
  return useCallback(
    (sentinel: HTMLDivElement | null) => {
      if (!sentinel || !onLoadMore || !enabled) return
      let armed = !waitForReentry
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) {
            armed = true
            return
          }
          if (armed) onLoadMore()
        },
        { rootMargin: '200px' }
      )
      observer.observe(sentinel)
      return () => observer.disconnect()
    },
    [onLoadMore, enabled, waitForReentry]
  )
}
