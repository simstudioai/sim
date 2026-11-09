'use client'

import { useSearchParams } from 'next/navigation'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { workspacePath } from '@/lib/navigation/paths'
import { ChangelogFeed } from '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed'
import { platformHref } from '@/platform/lib/navigation'
import type { ChangelogData } from '@/platform/shared/workspace-records'

interface ChangelogRouteProps {
  data: ChangelogData
}

/** The example history. Example time is fixed, so its age holds; live data refreshes itself. */
export function ChangelogRoute({ data }: ChangelogRouteProps) {
  const search = useSearchParams()
  return (
    <NuqsAdapter>
      <ChangelogFeed
        data={data}
        empty={{
          title: 'No changes yet',
          description: 'Approved issues appear here once their changes are applied.',
          action: {
            label: 'View issues',
            href: platformHref(workspacePath(data.workspace.id, 'issues'), search),
          },
        }}
      />
    </NuqsAdapter>
  )
}
