import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocumentView } from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/document-view/document-view'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Document' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: PageProps<'/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]'>) {
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
