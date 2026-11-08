'use client'

import { useLoadMore } from '@sim/emcn/scroll-area/use-load-more'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/list-end/list-end.module.css'

interface ListEndProps {
  hasMore: boolean
  onLoadMore: () => void
}

/**
 * The end of a quietly paged list: arriving near it asks for more, with no label, spinner or end
 * marker. The page's edge fade is what says more content continues.
 */
export function ListEnd({ hasMore, onLoadMore }: ListEndProps) {
  const sentinel = useLoadMore({ hasMore, onLoadMore })
  return <div ref={sentinel} className={styles.sentinel} aria-hidden='true' />
}
