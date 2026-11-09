'use client'

import { ControlRow } from '@sim/emcn/button/control-row'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import { CitedSources } from '@/app/(product)/_components/chat/panel/cited-sources'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { SearchResultsPanel } from '@/app/(product)/_components/search/search-results-host'

/** What a tab shows. A kind this app does not render yet opens in the legacy surface that does. */
export function ResourceContent({ resource }: { resource: PlatformResource }) {
  if (resource.type === 'search' && resource.search)
    return <SearchResultsPanel resource={resource} />
  if (resource.type === 'sources') return <CitedSources sources={resource.sources ?? []} />
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
