'use client'

import type { ReactNode, Ref } from 'react'
import { Button } from '@sim/emcn/button'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import styles from '@/platform/embedded/app/(shell)/links/_components/links-page/links-page.module.css'
import { openChromeStore } from '@/platform/embedded/lib/data/links'

interface LinksFrameProps {
  search?: string
  onSearch?: (value: string) => void
  onCreate?: () => void
  sortLabel?: string
  sortActions?: readonly MenuAction[]
  /** Holds the page's controls still while the route loads. */
  loading?: boolean
  mainRef?: Ref<HTMLElement>
  children: ReactNode
}

/** The page's title, actions, search and sort, shared with its loading state so nothing shifts. */
export function LinksFrame({
  search = '',
  onSearch,
  onCreate,
  sortLabel = 'Sort',
  sortActions = [],
  loading,
  mainRef,
  children,
}: LinksFrameProps) {
  const { hosted } = useDeploymentShape()
  return (
    <main ref={mainRef} className={styles.page} inert={loading} aria-busy={loading || undefined}>
      <header className={styles.heading}>
        <h1 data-type='T076'>Links</h1>
        <div className={styles.actions}>
          {hosted && (
            <Button icon='I049' onClick={openChromeStore}>
              Install Sim for Chrome
            </Button>
          )}
          <Button variant='primary' icon='I074' onClick={onCreate}>
            New link
          </Button>
        </div>
      </header>
      <div className={styles.options}>
        <SectionSearch subject='links' value={search} onValueChange={onSearch} />
        <ActionMenu label={sortLabel} align='end' actions={sortActions} />
      </div>
      {children}
    </main>
  )
}
