import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AccessBoundary } from '@/app/(product)/_components/workspace/access-required/access-boundary'
import { KnowledgeBase } from '@/app/(product)/_components/workspace/knowledge/knowledge-base/knowledge-base'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Knowledge base' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: ProductPageProps<{ workspaceId: string; knowledgeBaseId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const { workspaceId, knowledgeBaseId } = await params
  return (
    <AccessBoundary
      workspaceId={workspaceId}
      gate='hideKnowledgeBaseTab'
      current='knowledge'
      layout='fill'
    >
      <KnowledgeBase workspaceId={workspaceId} knowledgeBaseId={knowledgeBaseId} />
    </AccessBoundary>
  )
}
