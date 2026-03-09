'use client'

import { useEffect, useRef, useState } from 'react'

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

/**
 * Progressively renders a list of items so that first paint is fast.
 *
 * On mount (or when `key` changes), only the most recent `initialBatch`
 * items are rendered. The rest are added in `batchSize` increments via
 * `requestAnimationFrame` so the browser never blocks on a large DOM mount.
 *
 * Once staging completes for a given key it never re-stages -- new items
 * appended to the list are rendered immediately.
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
  const initialBatch = options?.initialBatch ?? DEFAULTS.initialBatch
  const batchSize = options?.batchSize ?? DEFAULTS.batchSize

  const completedKeysRef = useRef(new Set<string>())
  const prevKeyRef = useRef(key)
  const stagingCountRef = useRef(initialBatch)
  const [count, setCount] = useState(() => {
    if (items.length <= initialBatch) return items.length
    return initialBatch
  })

  useEffect(() => {
    if (completedKeysRef.current.has(key)) {
      setCount(items.length)
      return
    }

    if (items.length <= initialBatch) {
      setCount(items.length)
      completedKeysRef.current.add(key)
      return
    }

    let current = Math.max(stagingCountRef.current, initialBatch)
    setCount(current)

    let frame: number | undefined

    const step = () => {
      const total = items.length
      current = Math.min(total, current + batchSize)
      stagingCountRef.current = current
      setCount(current)
      if (current >= total) {
        completedKeysRef.current.add(key)
        frame = undefined
        return
      }
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [key, items.length, initialBatch, batchSize])

  let effectiveCount = count
  if (prevKeyRef.current !== key) {
    effectiveCount = items.length <= initialBatch ? items.length : initialBatch
    stagingCountRef.current = initialBatch
  }
  prevKeyRef.current = key

  const isCompleted = completedKeysRef.current.has(key)
  const isStaging = !isCompleted && effectiveCount < items.length
  const staged =
    isCompleted || effectiveCount >= items.length
      ? items
      : items.slice(Math.max(0, items.length - effectiveCount))

  return { staged, isStaging }
}
