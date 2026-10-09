import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { createSearchParamsCache } from 'nuqs/server'
import { getSession } from '@/lib/auth'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { Files } from '@/app/workspace/[workspaceId]/files/files'
import FilesLoading from '@/app/workspace/[workspaceId]/files/loading'
import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'
import {
  filesFilterParsers,
  filesFilterUrlKeys,
} from '@/app/workspace/[workspaceId]/files/search-params'

const searchParamsCache = createSearchParamsCache(filesFilterParsers, filesFilterUrlKeys)

interface FilesPageProps {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

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
export default async function FilesPage({ params, searchParams }: FilesPageProps) {
  const [{ workspaceId }, session, filters] = await Promise.all([
    params,
    getSession(),
    searchParamsCache.parse(searchParams),
  ])

  const queryClient = getQueryClient()
  await prefetchFilesBrowser(queryClient, workspaceId, session?.user?.id, {
    includeFiles: filters.searchMode !== 'contents',
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<FilesLoading />}>
        <Files />
      </Suspense>
    </HydrationBoundary>
  )
}
