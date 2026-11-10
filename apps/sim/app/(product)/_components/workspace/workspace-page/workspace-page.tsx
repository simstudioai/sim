'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import { DestinationTabs } from '@sim/emcn-platform/destination-tabs'
import { PageColumn } from '@sim/emcn-platform/page-column'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import styles from '@/app/(product)/_components/workspace/workspace-page/workspace-page.module.css'
import type { WorkspaceRead } from '@/app/(product)/_components/workspace/workspace-session/model'
import {
  useScrollMemory,
  useWorkspaceDataMode,
  useWorkspaceTabFlags,
} from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useLiveWorkspace } from '@/platform/lib/data/workspace-summary'
import { usePlatformHref } from '@/platform/lib/platform-href'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { type WorkspaceTab, workspaceTabs } from '@/platform/lib/workspace-navigation'
import type { TabWorkspace } from '@/platform/shared/workspace-records'

const READY: WorkspaceRead = { status: 'ready' }

const Embedded = createContext(false)

/**
 * Renders the workspace pages inside it as a chat panel tab shows them: each page's controls and
 * content, without the workspace's heading and tabs, bounded to the tab so its content scrolls
 * itself. A workspace the viewer cannot open reads as a failure there instead of not found.
 */
export function EmbeddedWorkspacePages({ children }: { children: ReactNode }) {
  return <Embedded.Provider value>{children}</Embedded.Provider>
}

/**
 * Whether this page shows in a chat panel tab, where it must not navigate the chat away: a missing
 * record shows its notice in the tab instead of sending the reader to its list.
 */
export function useEmbeddedWorkspacePage() {
  return useContext(Embedded)
}

interface WorkspacePageProps {
  /** The workspace the heading names; a live page passes what `useLiveWorkspace` read. */
  workspace: { id: string; name: string; description?: string }
  current: WorkspaceTab
  /** The tab's control bar, directly beneath the tabs. */
  controls?: ReactNode
  /** The tab's read; anything but ready replaces the content, never the chrome. */
  read?: WorkspaceRead
  /**
   * `page` scrolls with the shell. `fill` bounds the content to the space below the controls, in
   * the column, for a view that scrolls itself; `canvas` does the same across the pane's full
   * width, for a working surface such as a table grid or the workflow canvas.
   */
  layout?: 'page' | 'fill' | 'canvas'
  /** The tab's content; a tab whose sections are still to come has none. */
  children?: ReactNode
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
  layout = 'page',
  children,
}: WorkspacePageProps) {
  const hrefFor = usePlatformHref()
  const scrollMemory = useScrollMemory<HTMLElement>()
  const embedded = useEmbeddedWorkspacePage()
  const destinations = workspaceTabs(useWorkspaceDataMode(), useWorkspaceTabFlags()).map((tab) => ({
    section: tab.section,
    label: tab.label,
    href: hrefFor(workspacePath(workspace.id, tab.section)),
  }))
  const heading = <DirectoryHeading title={workspace.name} description={workspace.description} />
  const toolbar = (
    <div className={styles.toolbar}>
      <DestinationTabs
        label={`${workspace.name} pages`}
        destinations={destinations}
        currentHref={destinations.find((tab) => tab.section === current)?.href ?? ''}
      />
      {controls}
    </div>
  )
  const content =
    read.status === 'error' ? (
      <FailureNotice message={read.message} retrying={read.retrying} onRetry={read.onRetry} />
    ) : (
      read.status === 'ready' && children
    )
  if (embedded)
    return (
      <div className={styles.embedded}>
        {controls && <div className={styles.embeddedControls}>{controls}</div>}
        <div
          className={
            layout === 'canvas'
              ? styles.embeddedContent
              : `${styles.embeddedContent} ${layout === 'page' ? styles.embeddedScroll : styles.embeddedInset}`
          }
        >
          {content}
        </div>
      </div>
    )
  if (layout === 'canvas')
    return (
      <main className={styles.canvasPage}>
        <PageColumn>
          <div className={styles.canvasChrome}>
            {heading}
            {toolbar}
          </div>
        </PageColumn>
        <div className={styles.canvasContent}>{content}</div>
      </main>
    )
  if (layout === 'fill')
    return (
      <PageColumn>
        <main className={styles.page} data-bounded=''>
          {heading}
          {toolbar}
          <div className={styles.fillContent}>{content}</div>
        </main>
      </PageColumn>
    )
  return (
    <PageColumn>
      <main ref={scrollMemory} className={styles.page}>
        {heading}
        <div className={styles.body}>
          {toolbar}
          {content}
        </div>
      </main>
    </PageColumn>
  )
}

interface LiveWorkspacePageProps extends Omit<WorkspacePageProps, 'workspace'> {
  workspaceId: string
}

/**
 * A tab built on live data: the heading comes from the viewer's workspaces, and a workspace they
 * cannot open answers as not found. The page's own read takes over once the workspace is known.
 */
export function LiveWorkspacePage({
  workspaceId,
  current,
  controls,
  read,
  layout,
  children,
}: LiveWorkspacePageProps) {
  const live = useLiveWorkspace(workspaceId)
  const embedded = useEmbeddedWorkspacePage()
  if (live.missing && !embedded) notFound()
  const workspaceRead: WorkspaceRead = live.missing
    ? { status: 'error', message: 'You do not have access to this workspace.', onRetry: live.retry }
    : live.status === 'error'
      ? { status: 'error', message: 'This workspace could not be loaded.', onRetry: live.retry }
      : live.status === 'pending'
        ? { status: 'pending' }
        : (read ?? READY)
  return (
    <WorkspacePage
      workspace={live.workspace ?? { id: workspaceId, name: '' }}
      current={current}
      controls={controls}
      read={workspaceRead}
      layout={layout}
    >
      {children}
    </WorkspacePage>
  )
}

interface WorkspaceTabPageProps extends Omit<WorkspacePageProps, 'workspace'> {
  workspace: TabWorkspace
}

/** A tab that serves both modes: example data names its workspace, a live page reads the name. */
export function WorkspaceTabPage({
  workspace,
  current,
  controls,
  read,
  layout,
  children,
}: WorkspaceTabPageProps) {
  return 'live' in workspace ? (
    <LiveWorkspacePage
      workspaceId={workspace.id}
      current={current}
      controls={controls}
      read={read}
      layout={layout}
    >
      {children}
    </LiveWorkspacePage>
  ) : (
    <WorkspacePage
      workspace={workspace}
      current={current}
      controls={controls}
      read={read}
      layout={layout}
    >
      {children}
    </WorkspacePage>
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

/** The organization's New chat, keeping the preview's scenario and theme. */
export function useNewChatHref() {
  const hrefFor = usePlatformHref()
  return hrefFor(surfaceHref(useSurfaceScope(), '/chat'))
}
