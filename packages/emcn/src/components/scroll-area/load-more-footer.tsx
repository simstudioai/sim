'use client'

import { Button } from '#emcn/components/button/button'
import styles from '#emcn/components/scroll-area/scroll-area.module.css'
import { type LoadMoreState, useLoadMore } from '#emcn/components/scroll-area/use-load-more'

interface LoadMoreFooterProps {
  state: LoadMoreState
}

/**
 * The end of a paged list: requests the next page on arrival and reports a failure with Retry. The
 * next page's read paints nothing until its rows arrive.
 */
export function LoadMoreFooter({ state }: LoadMoreFooterProps) {
  const sentinel = useLoadMore(state)
  const retry = state.onRetry ?? state.onLoadMore
  return (
    <>
      <div ref={sentinel} className={styles.sentinel} aria-hidden='true' />
      {state.error && (
        <div className={styles.loadStatus} data-type='T060' role='alert'>
          <span>{state.error}</span>
          {retry && (
            <Button variant='quiet' size='compact' onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </>
  )
}
