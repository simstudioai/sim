'use client'

import { ControlRow } from '@sim/emcn/button/control-row'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import { BrowserSession } from '@/app/(product)/_components/chat/panel/browser-session/browser-session'
import { CitedSources } from '@/app/(product)/_components/chat/panel/cited-sources'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { TerminalSession } from '@/app/(product)/_components/chat/panel/terminal-session/terminal-session'
import { SearchResultsPanel } from '@/app/(product)/_components/search/search-results-host'

interface ResourceContentProps {
  resource: PlatformResource
  /** Whether this tab is the one on screen in an open panel. */
  visible: boolean
  desktopScopeId: string
}

/** What a tab shows. A kind this app does not render yet opens in the legacy surface that does. */
export function ResourceContent({ resource, visible, desktopScopeId }: ResourceContentProps) {
  if (resource.type === 'search' && resource.search)
    return <SearchResultsPanel resource={resource} />
  if (resource.type === 'browser')
    return <BrowserSession scopeId={desktopScopeId} visible={visible} />
  if (resource.type === 'terminal')
    return <TerminalSession scopeId={desktopScopeId} visible={visible} />
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
