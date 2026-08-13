import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isChatEnabled } from '@/lib/core/config/env-flags'
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

  /**
   * Home prefetches nothing of its own. Both lists it reads — workflow folders and
   * the workspace file list — are hydrated by `prefetchWorkspaceSidebar` in the
   * layout under the same keys, and re-reading them here would cost a second query
   * per request without reaching the server render.
   */
  const session = await getSession()
  const userId = session?.user?.id
  const tableViewsEnabled = await resolveTableViewsEnabled(workspaceId, userId)

  return (
    <Suspense fallback={<HomeFallback />}>
      <Home userName={session?.user?.name} userId={userId} tableViewsEnabled={tableViewsEnabled} />
    </Suspense>
  )
}
