'use client'

import { useCallback } from 'react'

/**
 * A callback ref for the element at the end of a paged list: `onLoadMore` runs when it scrolls
 * within 200px of view, while `enabled`. Pass `enabled: false` during a fetch, so the
 * observer is rebuilt when the fetch ends and fires again if the sentinel is still in view.
 */
export function useLoadMoreSentinel(onLoadMore: (() => void) | undefined, enabled: boolean) {
  return useCallback(
    (sentinel: HTMLDivElement | null) => {
      if (!sentinel || !onLoadMore || !enabled) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) onLoadMore()
        },
        { rootMargin: '200px' }
      )
      observer.observe(sentinel)
      return () => observer.disconnect()
    },
    [onLoadMore, enabled]
  )
}
