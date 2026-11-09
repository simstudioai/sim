'use client'

import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import { ChangelogFeed } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed'
import { useChangelogAccess, useLiveChangelog } from '@/platform/lib/data/changelog'

function Releases({ workspaceId }: { workspaceId: string }) {
  const live = useLiveChangelog(workspaceId)
  return (
    <ChangelogFeed
      read={live.read}
      data={live.data}
      older={live.older}
      empty={{
        title: 'No releases yet',
        description: 'Releases appear here when Sim publishes changes to this workspace.',
      }}
    />
  )
}

/** The workspace's releases, behind the same feature gate legacy's changelog has. */
export function LiveChangelog({ workspaceId }: { workspaceId: string }) {
  if (!useChangelogAccess(workspaceId).enabled)
    return (
      <LiveWorkspacePage workspaceId={workspaceId} current='changelog'>
        <WorkspaceEmpty title='The changelog is not enabled' />
      </LiveWorkspacePage>
    )
  return <Releases workspaceId={workspaceId} />
}
