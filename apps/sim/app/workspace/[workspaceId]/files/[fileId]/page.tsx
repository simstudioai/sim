import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import FilesFileLoading from '@/app/workspace/[workspaceId]/files/[fileId]/loading'
import { Files } from '@/app/workspace/[workspaceId]/files/files'
import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'

export const metadata: Metadata = {
  title: 'Files',
  robots: { index: false },
}

/**
 * File detail entry. `Files` resolves the open file out of the workspace file LIST, so this route
 * needs the same prefetch its sibling list page does — without it the server can only ever render
 * the "resolving the record" spinner, and the real header (breadcrumbs, actions) has to pop in a
 * frame later on the client.
 *
 * It also removes a whole class of hydration mismatch: which branch `Files` renders is decided by
 * whether that list is in the cache, so a server render without it and a client render with it
 * disagree on the header's markup (a static `…` crumb vs. the file's dropdown crumb). Prefetching
 * here makes both sides read the same cache and pick the same branch by construction.
 *
 * `Files` reads URL query params via nuqs (`useSearchParams` internally), so it must sit under a
 * Suspense boundary; the fallback is the detail chrome, matching the route's own `loading.tsx`.
 */
export default async function FilesFilePage({
  params,
}: {
  params: Promise<{ workspaceId: string; fileId: string }>
}) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])

  const queryClient = getQueryClient()
  if (session?.user?.id) {
    await prefetchFilesBrowser(queryClient, workspaceId, session.user.id)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<FilesFileLoading />}>
        <Files />
      </Suspense>
    </HydrationBoundary>
  )
}
