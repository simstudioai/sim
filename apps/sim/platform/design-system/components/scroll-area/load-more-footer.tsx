'use client'

import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/scroll-area/scroll-area.module.css'
import {
  type LoadMoreState,
  useLoadMore,
} from '@/platform/design-system/components/scroll-area/use-load-more'

interface LoadMoreFooterProps {
  state: LoadMoreState
}

/** The end of a paged list: requests the next page on arrival and reports loading and failure. */
export function LoadMoreFooter({ state }: LoadMoreFooterProps) {
  const sentinel = useLoadMore(state)
  const retry = state.onRetry ?? state.onLoadMore
  return (
    <>
      <div ref={sentinel} className={styles.sentinel} aria-hidden='true' />
      {(state.loading || state.error) && (
        <div
          className={styles.loadStatus}
          data-failed={state.error ? true : undefined}
          data-type='T060'
          role={state.error ? 'alert' : 'status'}
        >
          <span>{state.error ?? 'Loading…'}</span>
          {state.error && retry && (
            <Button variant='quiet' size='compact' onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </>
  )
}
