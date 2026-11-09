'use client'

import { AccessBoundary } from '@/app/(product)/_components/workspace/access-required/access-boundary'
import { ChangelogFeed } from '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed'
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

/**
 * The workspace's releases, behind the same Files access legacy's changelog requires: release notes
 * are workspace files, so a permission group that hides Files closes the changelog too.
 */
export function LiveChangelog({ workspaceId }: { workspaceId: string }) {
  return (
    <AccessBoundary workspaceId={workspaceId} gate='hideFilesTab' current='changelog'>
      <Releases workspaceId={workspaceId} />
    </AccessBoundary>
  )
}
