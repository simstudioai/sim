'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { DestinationTabs } from '@sim/emcn-platform/destination-tabs'
import { PageColumn } from '@sim/emcn-platform/page-column'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page.module.css'
import type { WorkspaceSummary } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { platformHref } from '@/platform/lib/navigation'
import {
  WORKSPACE_TABS,
  type WorkspaceTab,
  workspaceEntry,
  workspacePath,
} from '@/platform/lib/workspace-navigation'

interface WorkspacePageProps {
  workspace: WorkspaceSummary
  current: WorkspaceTab
  /** The tab's control bar, directly beneath the tabs. */
  controls?: ReactNode
  children: ReactNode
}

/**
 * A workspace tab: the workspace's name and description, its pages as tabs, the tab's controls and
 * its content. It shares the Integrations heading, tab row and control geometry.
 */
export function WorkspacePage({ workspace, current, controls, children }: WorkspacePageProps) {
  const search = useSearchParams()
  const destinations = WORKSPACE_TABS.map((tab) => ({
    section: tab.section,
    label: tab.label,
    href: platformHref(workspacePath(workspace.id, tab.section), search),
  }))
  return (
    <PageColumn>
      <main className={styles.page}>
        <DirectoryHeading title={workspace.name} description={workspace.description} />
        <div className={styles.body}>
          <div className={styles.toolbar}>
            <DestinationTabs
              label={`${workspace.name} pages`}
              destinations={destinations}
              currentHref={destinations.find((tab) => tab.section === current)?.href ?? ''}
            />
            {controls}
          </div>
          {children}
        </div>
      </main>
    </PageColumn>
  )
}

interface WorkspaceEmptyProps {
  title: string
  description?: string
  action?: { label: string; href: string }
}

/** An empty tab, centered in the space beneath its controls. */
export function WorkspaceEmpty({ title, description, action }: WorkspaceEmptyProps) {
  return (
    <div className={styles.empty}>
      <EmptyState
        title={title}
        description={description}
        action={
          action && (
            <Button variant='secondary' render={<Link href={action.href} />}>
              {action.label}
            </Button>
          )
        }
      />
    </div>
  )
}

/** The workspace's New chat, keeping the preview's scenario and theme. */
export function useNewChatHref(workspaceId: string) {
  return platformHref(workspaceEntry(workspaceId), useSearchParams())
}
