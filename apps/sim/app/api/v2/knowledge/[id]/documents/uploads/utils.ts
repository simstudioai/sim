import type { V2KnowledgeDocumentUpload } from '@/lib/api/contracts/v2/knowledge'
import type { CreatedKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { toV2DocumentSummary } from '@/app/api/v2/knowledge/utils'

export function toV2KnowledgeDocumentUpload(
  session: UploadSessionRecord,
  document: CreatedKnowledgeDocument | null
): V2KnowledgeDocumentUpload {
  if (!session.knowledgeBaseId) {
    throw new Error('Knowledge-document upload session is missing its knowledge base')
  }
  return {
    id: session.id,
    knowledgeBaseId: session.knowledgeBaseId,
    status: session.status,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: session.expiresAt.toISOString(),
    error: session.error,
    document: document ? toV2DocumentSummary(document) : null,
  }
}
