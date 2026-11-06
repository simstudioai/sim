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
  filesBrowserListParams,
  filesFilterParsers,
  filesFilterUrlKeys,
  filesParsers,
  filesSortParams,
} from '@/app/workspace/[workspaceId]/files/search-params'

/** The browser's URL state, read with the same parsers (and URL keys) the client binds. */
const filesViewCache = createSearchParamsCache(
  { ...filesParsers, ...filesFilterParsers, ...filesSortParams.parsers },
  { urlKeys: filesFilterUrlKeys.urlKeys }
)

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
export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ workspaceId }, session, view] = await Promise.all([
    params,
    getSession(),
    searchParams.then((raw) => filesViewCache.parse(raw)),
  ])

  const queryClient = getQueryClient()
  await prefetchFilesBrowser(queryClient, workspaceId, session?.user?.id, {
    list: filesBrowserListParams(view),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<FilesLoading />}>
        <Files />
      </Suspense>
    </HydrationBoundary>
  )
}
