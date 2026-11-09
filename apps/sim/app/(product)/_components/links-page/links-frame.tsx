'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'
import { SectionToolbar } from '@/app/(product)/_components/settings-parts/settings-parts'
import { openChromeStore, useLinksHosted } from '@/platform/lib/data/links'

interface LinksFrameProps {
  search: string
  onSearch: (value: string) => void
  onCreate: () => void
  sortLabel: string
  sortActions: readonly MenuAction[]
  children: ReactNode
}

/**
 * Links' search, sort and actions, painted before the first read of links settles. Links is a
 * Settings section, so the Settings screen owns the page's column, landmark and one heading.
 */
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
    <div className={styles.page}>
      <SectionToolbar
        grow={
          <SearchField
            label='Search links'
            placeholder='Search links...'
            value={search}
            onValueChange={onSearch}
          />
        }
      >
        <ActionMenu
          label={sortLabel}
          icon={null}
          triggerSize='compact'
          align='end'
          actions={sortActions}
        />
        {hosted && (
          <Button icon='I041' onClick={openChromeStore}>
            Install Sim for Chrome
          </Button>
        )}
        <Button variant='primary' icon='I074' onClick={onCreate}>
          New link
        </Button>
      </SectionToolbar>
      {children}
    </div>
  )
}
