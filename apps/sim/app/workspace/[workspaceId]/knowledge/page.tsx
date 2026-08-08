import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
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
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])

  const queryClient = getQueryClient()
  if (session?.user?.id) {
    await prefetchKnowledgeBases(queryClient, workspaceId, session.user.id)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<KnowledgeLoading />}>
        <Knowledge />
      </Suspense>
    </HydrationBoundary>
  )
}
