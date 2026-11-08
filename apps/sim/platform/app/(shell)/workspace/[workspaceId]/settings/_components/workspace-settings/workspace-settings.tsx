'use client'

import {
  LiveWorkspacePage,
  WorkspacePage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type { WorkspaceSummary } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'

/** The workspace's settings: the tab is in place, and its sections are still to come. */
export function WorkspaceSettings({ workspace }: { workspace: WorkspaceSummary }) {
  return <WorkspacePage workspace={workspace} current='settings' />
}

/** The same tab on live data. */
export function LiveWorkspaceSettings({ workspaceId }: { workspaceId: string }) {
  return <LiveWorkspacePage workspaceId={workspaceId} current='settings' />
}
