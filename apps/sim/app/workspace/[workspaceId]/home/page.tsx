import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { prefetchHomeLists } from '@/app/workspace/[workspaceId]/home/prefetch'
import { resolveTableViewsEnabled } from '@/app/workspace/[workspaceId]/home/resolve-table-views-flag'
import { Home } from './home'
import { HomeFallback } from './home-fallback'

export const metadata: Metadata = {
  title: 'New chat',
}

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params

  // The layout redirects too, but pages and layouts resolve concurrently — without
  // this the prefetch below still fires on its way out.
  if (!isChatEnabled) {
    redirect(`/workspace/${workspaceId}`)
  }

  const queryClient = getQueryClient()
  const listsPrefetch = prefetchHomeLists(queryClient, workspaceId)

  const session = await getSession()
  const userId = session?.user?.id
  const tableViewsEnabled = await resolveTableViewsEnabled(workspaceId, userId)
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
