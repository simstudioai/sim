import { NextResponse } from 'next/server'
import type {
  V2KnowledgeDocumentSummary,
  V2KnowledgeDocumentUpload,
} from '@/lib/api/contracts/v2/knowledge'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import type { CreatedKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import {
  getOwnedUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/multipart-session/service'
import { resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import type { RateLimitResult } from '@/app/api/v1/middleware'
import { v2Error } from '@/app/api/v2/lib/response'

export async function resolveKnowledgeDocumentUploadAccess(params: {
  knowledgeBaseId: string
  workspaceId: string
  userId: string
  rateLimit: RateLimitResult
}): Promise<{ kb: KnowledgeBaseWithCounts } | NextResponse> {
  const result = await resolveKnowledgeBase(
    params.knowledgeBaseId,
    params.workspaceId,
    params.userId,
    params.rateLimit,
    'write'
  )
  if (!(result instanceof NextResponse)) return result
  if (result.status === 404) return v2Error('NOT_FOUND', 'Knowledge base not found')
  return v2Error('FORBIDDEN', 'Access denied')
}

export async function resolveKnowledgeDocumentUploadBilling(params: {
  workspaceId: string
  userId: string
  rateLimit: RateLimitResult
}): Promise<BillingAttributionSnapshot | NextResponse> {
  const attribution =
    params.rateLimit.keyType === 'workspace'
      ? await resolveSystemBillingAttribution(params.workspaceId)
      : await resolveBillingAttribution({
          actorUserId: params.userId,
          workspaceId: params.workspaceId,
        })
  const usage = await checkAttributedUsageLimits(attribution)
  if (usage.isExceeded) {
    return v2Error(
      'USAGE_LIMIT_EXCEEDED',
      usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
    )
  }
  return attribution
}

export function getOwnedKnowledgeDocumentUpload(params: {
  knowledgeBaseId: string
  uploadId: string
  workspaceId: string
  userId: string
  uploadToken: string
}): UploadSessionRecord {
  return getOwnedUploadSession({
    uploadId: params.uploadId,
    workspaceId: params.workspaceId,
    userId: params.userId,
    purpose: 'knowledge_document',
    knowledgeBaseId: params.knowledgeBaseId,
    uploadToken: params.uploadToken,
  })
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
    partSize: session.partSize,
    partCount: session.partCount,
    uploadToken: session.uploadToken,
    expiresAt: session.expiresAt.toISOString(),
    error: session.error,
    document: document ? toV2KnowledgeDocumentSummary(document) : null,
  }
}

export function knowledgeDocumentFileUrl(session: UploadSessionRecord): string {
  if (session.storageContext !== 'knowledge-base') {
    throw new Error('Knowledge-document upload has an invalid storage context')
  }
  const providerPrefix = session.storageProvider === 'local' ? '' : `${session.storageProvider}/`
  return `/api/files/serve/${providerPrefix}${encodeURIComponent(session.storageKey)}?context=knowledge-base`
}
