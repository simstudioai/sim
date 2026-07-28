import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { prefetchHomeLists } from '@/app/workspace/[workspaceId]/home/prefetch'
import { Home } from './home'
import { HomeFallback } from './home-fallback'

export const metadata: Metadata = {
  title: 'New chat',
}

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params

  const queryClient = getQueryClient()
  const listsPrefetch = prefetchHomeLists(queryClient, workspaceId)

  const session = await getSession()
  const userId = session?.user?.id
  // Resolved here for the same reason the table page does it: the flag's gating
  // lives in AppConfig, which has no client counterpart, and the embedded table is
  // a client component. Keyed on the workspace's host organization, matching the
  // table page so both surfaces gate identically. Both reads are request-memoized.
  const host = userId ? await getWorkspaceHostContextForViewer(workspaceId, userId) : null
  const tableViewsEnabled = await isFeatureEnabled('table-views', {
    userId,
    orgId: host?.hostOrganizationId ?? undefined,
  })
  await listsPrefetch

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<HomeFallback />}>
        <Home
          userName={session?.user?.name}
          userId={userId}
          tableViewsEnabled={tableViewsEnabled}
        />
      </Suspense>
    </HydrationBoundary>
  )
}
