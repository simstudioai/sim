'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface ProgressiveListOptions {
  /** Number of items to render in the initial batch (most recent items) */
  initialBatch?: number
  /** Number of items to add per animation frame */
  batchSize?: number
}

const DEFAULTS = {
  initialBatch: 10,
  batchSize: 5,
} satisfies Required<ProgressiveListOptions>

interface ProgressiveListState {
  key: string
  count: number
  caughtUp: boolean
}

function createInitialState(
  key: string,
  itemCount: number,
  initialBatch: number
): ProgressiveListState {
  const count = Math.min(itemCount, initialBatch)
  return {
    key,
    count,
    caughtUp: itemCount > 0 && count >= itemCount,
  }
}

/**
 * Progressively renders a list of items so that first paint is fast.
 *
 * On mount (or when `key` changes), only the most recent `initialBatch`
 * items are rendered. The rest are added in `batchSize` increments via
 * `requestAnimationFrame`.
 *
 * @param items    Full list of items to render.
 * @param key      A session/conversation identifier. When it changes,
 *                 staging restarts for the new list.
 * @param options  Tuning knobs for batch sizes.
 * @returns        The currently staged (visible) subset of items.
 */
export function useProgressiveList<T>(
  items: T[],
  key: string,
  options?: ProgressiveListOptions
): { staged: T[]; isStaging: boolean } {
  const initialBatch = Math.max(0, options?.initialBatch ?? DEFAULTS.initialBatch)
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULTS.batchSize)
  const [state, setState] = useState(() => createInitialState(key, items.length, initialBatch))
  const latestItemCountRef = useRef(items.length)

  useLayoutEffect(() => {
    latestItemCountRef.current = items.length
  }, [items.length])

  const renderState =
    state.key === key && (state.count > 0 || items.length === 0 || state.caughtUp)
      ? state
      : createInitialState(key, items.length, initialBatch)

  useEffect(() => {
    setState((prev) => {
      if (prev.key !== key) {
        return createInitialState(key, items.length, initialBatch)
      }

      if (items.length === 0) {
        if (prev.count === 0 && !prev.caughtUp) {
          return prev
        }
        return { key, count: 0, caughtUp: false }
      }

      if (prev.caughtUp) {
        if (prev.count === items.length) {
          return prev
        }
        return { key, count: items.length, caughtUp: true }
      }

      const minimumCount = Math.min(items.length, initialBatch)
      if (prev.count >= minimumCount && prev.count <= items.length) {
        return prev
      }

      const count = Math.min(items.length, Math.max(prev.count, minimumCount))
      return {
        key,
        count,
        caughtUp: count >= items.length,
      }
    })
  }, [key, items.length, initialBatch])

  useEffect(() => {
    if (state.key !== key || state.caughtUp || state.count >= items.length) {
      return
    }

    const frame = requestAnimationFrame(() => {
      setState((prev) => {
        if (prev.key !== key || prev.caughtUp) {
          return prev
        }

        const itemCount = latestItemCountRef.current
        const count = Math.min(itemCount, prev.count + batchSize)
        return {
          key,
          count,
          caughtUp: count >= itemCount,
        }
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [state.key, state.count, state.caughtUp, key, items.length, batchSize])

  const effectiveCount = renderState.caughtUp
    ? items.length
    : Math.min(renderState.count, items.length)
  const staged = items.slice(Math.max(0, items.length - effectiveCount))
  const isStaging = effectiveCount < items.length

  return { staged, isStaging }
}
