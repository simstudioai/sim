import type { NextResponse } from 'next/server'
import type {
  V2KnowledgeDocumentSummary,
  V2KnowledgeDocumentUpload,
} from '@/lib/api/contracts/v2/knowledge'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import type { CreatedKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { serializeDate } from '@/app/api/v1/knowledge/utils'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export function v2KnowledgeDocumentUploadError(error: unknown): NextResponse | null {
  if (error instanceof KnowledgeDocumentUnsupportedMediaTypeError) {
    return v2Error('UNSUPPORTED_MEDIA_TYPE', error.message)
  }
  if (error instanceof KnowledgeUsageLimitExceededError) {
    return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
  }
  return v2CaughtOrchestrationError(error)
}

export function toV2KnowledgeDocumentSummary(
  document: CreatedKnowledgeDocument
): V2KnowledgeDocumentSummary {
  return {
    id: document.id,
    knowledgeBaseId: document.knowledgeBaseId,
    filename: document.filename,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    processingStatus: document.processingStatus ?? 'pending',
    chunkCount: document.chunkCount,
    tokenCount: document.tokenCount,
    characterCount: document.characterCount,
    enabled: document.enabled,
    createdAt: serializeDate(document.uploadedAt),
  }
}

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
    document: document ? toV2KnowledgeDocumentSummary(document) : null,
  }
}
