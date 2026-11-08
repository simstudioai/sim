'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { ChangelogData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useSessionRefresh } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { ChangelogFeed } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed'

interface ChangelogRouteProps {
  data: ChangelogData
}

/** Example history with session-only refreshes: entries stay the same, the timestamp moves. */
export function ChangelogRoute({ data }: ChangelogRouteProps) {
  const { refreshedAt, refresh } = useSessionRefresh(`changelog/${data.workspace.id}`)
  return (
    <NuqsAdapter>
      <ChangelogFeed
        data={{ ...data, updatedAt: refreshedAt ?? data.updatedAt }}
        actions={{ refresh: () => refresh(data.referenceTime) }}
      />
    </NuqsAdapter>
  )
}
