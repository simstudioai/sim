'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  type VirtualItem,
} from '@tanstack/react-virtual'
import styles from '@/app/(product)/_components/workspace/resource-table/resource-table.module.css'

/** Rows drawn beyond the viewport, so a fast scroll never shows a blank band. */
const OVERSCAN = 8
/** A row's resting height with its list gap, before it is measured. */
const ROW_ESTIMATE = 42
const LIST_GAP = 2
const FIRST_PAINT = { width: 0, height: 960 }

interface VirtualRowsOptions {
  /** A row kept mounted wherever it sits, so a returning list can scroll it into view. */
  pinnedId?: string | null
}

/**
 * Windows a list of rows in the shell's vertical scroller: only the rows near the viewport mount,
 * and spacers keep the list's full height. The list element takes `listRef`; each mounted row's
 * `li` takes `virtualizer.measureElement` and its `data-index`.
 */
export function useVirtualRows<Row extends { id: string }>(
  rows: readonly Row[],
  { pinnedId }: VirtualRowsOptions = {}
) {
  const listRef = useRef<HTMLOListElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)
  const hasRows = rows.length > 0

  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return
    const viewport = element.closest<HTMLElement>('[data-scroll-axis="vertical"]')
    setScroller(viewport)
    if (!viewport) return
    const measure = () => {
      const offset =
        element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop
      setMargin((current) => (Math.abs(current - offset) < 1 ? current : offset))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    const page = element.closest('main')
    if (page) observer.observe(page)
    return () => observer.disconnect()
  }, [hasRows])

  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])
  const pinnedIndex = pinnedId ? rows.findIndex((row) => row.id === pinnedId) : -1
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (pinnedIndex < 0 || indexes.includes(pinnedIndex)) return indexes
      return [...indexes, pinnedIndex].sort((left, right) => left - right)
    },
    [pinnedIndex]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    gap: LIST_GAP,
    scrollMargin: margin,
    getItemKey,
    rangeExtractor,
    initialRect: FIRST_PAINT,
    // Measuring a row as it mounts must not flush a render into a list still mounting.
    useFlushSync: false,
  })

  const entries: { key: VirtualItem['key']; index: number; row: Row; spaceBefore: number }[] = []
  // Where the content before the next row ends; a spacer sits between list gaps.
  let end = margin - LIST_GAP
  for (const item of virtualizer.getVirtualItems()) {
    const row = rows[item.index]
    if (!row) continue
    entries.push({
      key: item.key,
      index: item.index,
      row,
      spaceBefore: Math.max(0, item.start - end - 2 * LIST_GAP),
    })
    end = item.end
  }
  const spaceAfter = Math.max(0, virtualizer.getTotalSize() + margin - end - LIST_GAP)

  return { listRef, virtualizer, entries, spaceAfter }
}

/** Stands in for the rows outside the window, keeping the list's full height. */
export function VirtualSpacer({ blockSize }: { blockSize: number }) {
  if (blockSize <= 0) return null
  return (
    <li
      className={styles.spacer}
      aria-hidden='true'
      ref={(element) => {
        element?.style.setProperty('block-size', `${blockSize}px`)
      }}
    />
  )
}
