'use client'

import { useCallback } from 'react'

export interface LoadMoreState {
  hasMore?: boolean
  loading?: boolean
  error?: string
  onLoadMore?: () => void
  /** What Retry runs after `error`, when that is not asking for the next page. */
  onRetry?: () => void
}

/**
 * A callback ref for the element at the end of a paged list: `onLoadMore` runs when it scrolls
 * within 200px of its vertical scroller or the window. `loading` rebuilds the observer as the fetch
 * settles, so a sentinel still in view asks again. After a failure it asks only once the sentinel
 * leaves view and returns, so a failing request does not retry in a loop.
 */
export function useLoadMore({ hasMore, loading, error, onLoadMore }: LoadMoreState) {
  const enabled = Boolean(hasMore && !loading)
  const failed = Boolean(error)
  return useCallback(
    (sentinel: HTMLDivElement | null) => {
      if (!sentinel || !onLoadMore || !enabled) return
      let armed = !failed
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) armed = true
          else if (armed) onLoadMore()
        },
        {
          root: sentinel.parentElement?.closest('[data-scroll-axis="vertical"]') ?? null,
          rootMargin: '200px',
        }
      )
      observer.observe(sentinel)
      return () => observer.disconnect()
    },
    [onLoadMore, enabled, failed]
  )
}
