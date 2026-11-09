import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AccessBoundary } from '@/app/(product)/_components/workspace/access-required/access-boundary'
import { DocumentView } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/document-view/document-view'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Document' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: ProductPageProps<{ workspaceId: string; knowledgeBaseId: string; documentId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const { workspaceId, knowledgeBaseId, documentId } = await params
  return (
    <AccessBoundary
      workspaceId={workspaceId}
      gate='hideKnowledgeBaseTab'
      current='knowledge'
      layout='fill'
    >
      <DocumentView
        workspaceId={workspaceId}
        knowledgeBaseId={knowledgeBaseId}
        documentId={documentId}
      />
    </AccessBoundary>
  )
}
