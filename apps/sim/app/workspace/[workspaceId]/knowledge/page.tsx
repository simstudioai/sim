import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { prefetchKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/prefetch'
import { Knowledge } from './knowledge'

export const metadata: Metadata = {
  title: 'Knowledge Base',
}

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
      <Knowledge />
    </HydrationBoundary>
  )
}
