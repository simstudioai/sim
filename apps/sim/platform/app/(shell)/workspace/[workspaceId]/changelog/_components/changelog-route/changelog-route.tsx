'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { ChangelogData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { ChangelogFeed } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed'

interface ChangelogRouteProps {
  data: ChangelogData
}

/** The example history. Example time is fixed, so its age holds; live data refreshes itself. */
export function ChangelogRoute({ data }: ChangelogRouteProps) {
  return (
    <NuqsAdapter>
      <ChangelogFeed data={data} />
    </NuqsAdapter>
  )
}
