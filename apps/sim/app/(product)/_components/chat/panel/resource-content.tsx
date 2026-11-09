'use client'

import { ControlRow } from '@sim/emcn/button/control-row'
import { EmptyState } from '@sim/emcn/empty-state'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import { BrowserSession } from '@/app/(product)/_components/chat/panel/browser-session/browser-session'
import { CitedSources } from '@/app/(product)/_components/chat/panel/cited-sources'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { TerminalSession } from '@/app/(product)/_components/chat/panel/terminal-session/terminal-session'
import { SearchResultsPanel } from '@/app/(product)/_components/search/search-results-host'

/** Loaded with the first workspace tab, so a chat that never opens one never downloads its views. */
const WorkspaceResource = dynamic(
  () =>
    import('@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource').then(
      (module) => module.WorkspaceResource
    ),
  { ssr: false }
)

/** The kinds a tab shows live, in the same view their workspace page shows. */
const WORKSPACE_KINDS: ReadonlySet<string> = new Set([
  'file',
  'table',
  'knowledgebase',
  'dashboard',
  'workflow',
  'log',
  'folder',
])

interface ResourceContentProps {
  resource: PlatformResource
  /** Whether this tab is the one on screen in an open panel. */
  visible: boolean
  /** Whether this is the panel's current tab, shown or not; only it keeps a workspace view mounted. */
  selected: boolean
  desktopScopeId: string
}

/** What a tab shows. A kind this app does not render yet links to the surface that does. */
export function ResourceContent({
  resource,
  visible,
  selected,
  desktopScopeId,
}: ResourceContentProps) {
  if (resource.type === 'search' && resource.search)
    return <SearchResultsPanel resource={resource} />
  if (resource.type === 'browser')
    return <BrowserSession scopeId={desktopScopeId} visible={visible} />
  if (resource.type === 'terminal')
    return <TerminalSession scopeId={desktopScopeId} visible={visible} />
  if (resource.type === 'sources') return <CitedSources sources={resource.sources ?? []} />
  if (resource.workspaceId && WORKSPACE_KINDS.has(resource.type))
    return selected ? (
      <WorkspaceResource resource={resource} workspaceId={resource.workspaceId} />
    ) : null
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
