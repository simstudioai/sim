import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import KnowledgeLoading from '@/app/workspace/[workspaceId]/knowledge/loading'
import { prefetchKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/prefetch'
import { Knowledge } from './knowledge'

export const metadata: Metadata = {
  title: 'Knowledge Base',
}

/**
 * Knowledge Base page entry. `Knowledge` reads URL query params via nuqs (which
 * uses `useSearchParams` internally), so it must sit under a Suspense boundary.
 * The fallback renders the real chrome so a suspend never shows a blank frame;
 * the route-level `loading.tsx` covers the navigation/chunk-load transition.
 */
export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  const queryClient = getQueryClient()
  await prefetchKnowledgeBases(queryClient, workspaceId)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<KnowledgeLoading />}>
        <Knowledge />
      </Suspense>
    </HydrationBoundary>
  )
}
