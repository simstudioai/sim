import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import InterfacesLoading from '@/app/workspace/[workspaceId]/interfaces/loading'
import { prefetchInterfaces } from '@/app/workspace/[workspaceId]/interfaces/prefetch'
import { Interfaces } from './interfaces'

export const metadata: Metadata = {
  title: 'Interfaces',
}

/**
 * Interfaces page entry. `Interfaces` reads URL query params via nuqs (which
 * uses `useSearchParams` internally), so it must sit under a Suspense boundary.
 * The fallback renders the real chrome so a suspend never shows a blank frame;
 * the route-level `loading.tsx` covers the navigation/chunk-load transition.
 */
export default async function InterfacesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  const queryClient = getQueryClient()
  await prefetchInterfaces(queryClient, workspaceId)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<InterfacesLoading />}>
        <Interfaces />
      </Suspense>
    </HydrationBoundary>
  )
}
