'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import { PageColumn } from '@sim/emcn-platform/page-column'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'
import { openChromeStore, useLinksHosted } from '@/platform/lib/data/links'

interface LinksFrameProps {
  search: string
  onSearch: (value: string) => void
  onCreate: () => void
  sortLabel: string
  sortActions: readonly MenuAction[]
  children: ReactNode
}

/** The page's title, actions, search and sort, painted before the first read of links settles. */
export function LinksFrame({
  search,
  onSearch,
  onCreate,
  sortLabel,
  sortActions,
  children,
}: LinksFrameProps) {
  const hosted = useLinksHosted()
  return (
    <PageColumn>
      <main className={styles.page}>
        <header className={styles.heading}>
          <h1 data-type='T076'>Links</h1>
          <div className={styles.actions}>
            {hosted && (
              <Button icon='I041' onClick={openChromeStore}>
                Install Sim for Chrome
              </Button>
            )}
            <Button variant='primary' icon='I074' onClick={onCreate}>
              New link
            </Button>
          </div>
        </header>
        <div className={styles.options}>
          <SearchField
            variant='quiet'
            label='Search links'
            placeholder='Search links...'
            value={search}
            onValueChange={onSearch}
          />
          <ActionMenu
            label={sortLabel}
            icon={null}
            triggerSize='compact'
            align='end'
            actions={sortActions}
          />
        </div>
        {children}
      </main>
    </PageColumn>
  )
}
