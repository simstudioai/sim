import { Document } from '@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/document'

interface DocumentPageProps {
  params: Promise<{
    id: string
    documentId: string
  }>
  searchParams: Promise<{
    kbName?: string
    docName?: string
  }>
}

export default async function DocumentChunksPage({ params, searchParams }: DocumentPageProps) {
  const { id, documentId } = await params
  const { kbName, docName } = await searchParams

  return (
    <Document
      knowledgeBaseId={id}
      documentId={documentId}
      knowledgeBaseName={kbName || 'Knowledge Base'}
      documentName={docName || 'Document'}
    />
  )
}
