'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import { DestinationTabs } from '@sim/emcn-platform/destination-tabs'
import { PageColumn } from '@sim/emcn-platform/page-column'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page.module.css'
import type {
  WorkspaceRead,
  WorkspaceSummary,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useScrollMemory } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { platformHref } from '@/platform/lib/navigation'
import {
  WORKSPACE_TABS,
  type WorkspaceTab,
  workspaceEntry,
  workspacePath,
} from '@/platform/lib/workspace-navigation'

const READY: WorkspaceRead = { status: 'ready' }

interface WorkspacePageProps {
  workspace: WorkspaceSummary
  current: WorkspaceTab
  /** The tab's control bar, directly beneath the tabs. */
  controls?: ReactNode
  /** The tab's read; anything but ready replaces the content, never the chrome. */
  read?: WorkspaceRead
  children: ReactNode
}

/**
 * A workspace tab: the workspace's name and description, its pages as tabs, the tab's controls and
 * its content. It shares the Integrations heading, tab row and control geometry.
 */
export function WorkspacePage({
  workspace,
  current,
  controls,
  read = READY,
  children,
}: WorkspacePageProps) {
  const search = useSearchParams()
  const scrollMemory = useScrollMemory<HTMLElement>()
  const destinations = WORKSPACE_TABS.map((tab) => ({
    section: tab.section,
    label: tab.label,
    href: platformHref(workspacePath(workspace.id, tab.section), search),
  }))
  return (
    <PageColumn>
      <main ref={scrollMemory} className={styles.page}>
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
          {read.status === 'error' ? (
            <FailureNotice message={read.message} retrying={read.retrying} onRetry={read.onRetry} />
          ) : (
            read.status === 'ready' && children
          )}
        </div>
      </main>
    </PageColumn>
  )
}

interface WorkspaceEmptyProps {
  title: string
  description?: string
  /** A destination, such as New chat, or an in-place reset, such as Clear filters. */
  action?: { label: string; href: string } | { label: string; onClick: () => void }
}

/** An empty tab, centered in the space beneath its controls. */
export function WorkspaceEmpty({ title, description, action }: WorkspaceEmptyProps) {
  return (
    <div className={styles.empty}>
      <EmptyState
        title={title}
        description={description}
        action={
          action &&
          ('href' in action ? (
            <Button variant='secondary' render={<Link href={action.href} />}>
              {action.label}
            </Button>
          ) : (
            <Button variant='secondary' onClick={action.onClick}>
              {action.label}
            </Button>
          ))
        }
      />
    </div>
  )
}

/** The workspace's New chat, keeping the preview's scenario and theme. */
export function useNewChatHref(workspaceId: string) {
  return platformHref(workspaceEntry(workspaceId), useSearchParams())
}
