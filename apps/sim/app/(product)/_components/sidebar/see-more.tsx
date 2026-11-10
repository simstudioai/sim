'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn/button'

/**
 * Pages a sidebar section: the first `pageSize` rows, then See more a page at a time and See less
 * back to one page. An absent `pageSize` shows every row and no control.
 */
export function useSeeMore<T>(items: readonly T[], pageSize: number | undefined) {
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const hasMore = visibleCount !== undefined && items.length > visibleCount
  const control =
    pageSize !== undefined && items.length > pageSize ? (
      <Chip onClick={() => setVisibleCount(hasMore ? visibleCount + pageSize : pageSize)}>
        {hasMore ? 'See more' : 'See less'}
      </Chip>
    ) : null
  return { visible: items.slice(0, visibleCount), control }
}
