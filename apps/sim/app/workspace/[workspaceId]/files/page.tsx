import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'
import { Files } from './files'
import FilesLoading from './loading'

export const metadata: Metadata = {
  title: 'Files',
  robots: { index: false },
}

/**
 * Files page entry. `Files` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome (header + options +
 * table headers) so a suspend never shows a blank frame; the route-level
 * `loading.tsx` covers the navigation/chunk-load transition the same way.
 */
export default async function FilesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])

  const queryClient = getQueryClient()
  if (session?.user?.id) {
    await prefetchFilesBrowser(queryClient, workspaceId, session.user.id)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<FilesLoading />}>
        <Files />
      </Suspense>
    </HydrationBoundary>
  )
}
