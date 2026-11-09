'use client'

import { ChangelogAccess } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-access/changelog-access'
import { ChangelogFeed } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed'
import { useLiveChangelog } from '@/platform/lib/data/changelog'

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

/** The workspace's releases, behind the same Files access legacy's changelog requires. */
export function LiveChangelog({ workspaceId }: { workspaceId: string }) {
  return (
    <ChangelogAccess workspaceId={workspaceId}>
      <Releases workspaceId={workspaceId} />
    </ChangelogAccess>
  )
}
