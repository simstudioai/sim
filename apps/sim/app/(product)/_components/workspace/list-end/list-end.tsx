'use client'

import { useLoadMore } from '@sim/emcn/scroll-area/use-load-more'
import styles from '@/app/(product)/_components/workspace/list-end/list-end.module.css'

export interface ListEndProps {
  hasMore: boolean
  onLoadMore: () => void
  /** A page the server is still answering; the sentinel asks again once it settles. */
  loading?: boolean
  /** Why the last page failed; the sentinel asks again only after leaving view and returning. */
  error?: string
}

/**
 * The end of a quietly paged list: arriving near it asks for more, with no label, spinner or end
 * marker. The page's edge fade is what says more content continues.
 */
export function ListEnd({ hasMore, onLoadMore, loading, error }: ListEndProps) {
  const sentinel = useLoadMore({ hasMore, loading, error, onLoadMore })
  return <div ref={sentinel} className={styles.sentinel} aria-hidden='true' />
}
