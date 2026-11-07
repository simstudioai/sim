'use client'

import { ControlRow } from '@sim/emcn/button/control-row'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import type { PlatformResource } from '@/platform/app/(shell)/_components/chat/model'
import styles from '@/platform/app/(shell)/_components/chat/panel/panels.module.css'
import { SearchResultsPanel } from '@/platform/app/(shell)/_components/search/search-results-host'

/** What a tab shows. A kind this app does not render yet opens in the legacy surface that does. */
export function ResourceContent({ resource }: { resource: PlatformResource }) {
  if (resource.type === 'search' && resource.search)
    return <SearchResultsPanel resource={resource} />
  return (
    <div className={styles.document}>
      <EmptyState
        title={resource.title}
        description='Open this in its workspace to view and edit it.'
        action={
          resource.href ? (
            <ControlRow
              render={<Link href={resource.href} target='_blank' rel='noopener noreferrer' />}
              label={`Open ${resource.title}`}
              trailingIcon='I030'
            />
          ) : undefined
        }
      />
    </div>
  )
}
