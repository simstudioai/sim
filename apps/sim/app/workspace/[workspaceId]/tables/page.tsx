import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import TablesLoading from '@/app/workspace/[workspaceId]/tables/loading'
import { prefetchTables } from '@/app/workspace/[workspaceId]/tables/prefetch'
import { Tables } from './tables'

export const metadata: Metadata = {
  title: 'Tables',
}

/**
 * Tables page entry. `Tables` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome so a suspend never shows a blank frame; the
 * route-level `loading.tsx` covers the navigation/chunk-load transition.
 */
export default async function TablesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  const queryClient = getQueryClient()
  await prefetchTables(queryClient, workspaceId, session?.user?.id)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<TablesLoading />}>
        <Tables />
      </Suspense>
    </HydrationBoundary>
  )
}
