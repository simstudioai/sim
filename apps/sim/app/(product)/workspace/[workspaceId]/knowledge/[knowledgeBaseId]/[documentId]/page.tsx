import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocumentView } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/document-view/document-view'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Document' }

/** The mode is per-request; a build must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: ProductPageProps<{ workspaceId: string; knowledgeBaseId: string; documentId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const { workspaceId, knowledgeBaseId, documentId } = await params
  return (
    <DocumentView
      workspaceId={workspaceId}
      knowledgeBaseId={knowledgeBaseId}
      documentId={documentId}
    />
  )
}
