import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type {
  V2KnowledgeDocumentSummary,
  V2KnowledgeDocumentUpload,
} from '@/lib/api/contracts/v2/knowledge'
import { v2KnowledgeDocumentUploadMetadataSchema } from '@/lib/api/contracts/v2/knowledge'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { performUploadKnowledgeDocument } from '@/lib/knowledge/orchestration'
import type { CreatedKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import { findBoundKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { recordKnowledgeBaseFileOwnership } from '@/lib/uploads/server/metadata'
import {
  abortUploadSession,
  type CreatedUploadSession,
  createUploadSession,
  getOwnedUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
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

/**
 * Resolves the payer for an upload without enforcing usage limits. Completion uses this
 * because its bytes were already admitted when the session was created; re-running
 * admission there would strand uploaded parts and fail idempotent completion retries.
 */
export async function resolveKnowledgeDocumentUploadAttribution(params: {
  workspaceId: string
  userId: string
  rateLimit: RateLimitResult
}): Promise<BillingAttributionSnapshot> {
  return params.rateLimit.keyType === 'workspace'
    ? resolveSystemBillingAttribution(params.workspaceId)
    : resolveBillingAttribution({
        actorUserId: params.userId,
        workspaceId: params.workspaceId,
      })
}

/** Admission check for a new upload session. Enforced only at session creation. */
export async function resolveKnowledgeDocumentUploadBilling(params: {
  workspaceId: string
  userId: string
  rateLimit: RateLimitResult
}): Promise<BillingAttributionSnapshot | NextResponse> {
  const attribution = await resolveKnowledgeDocumentUploadAttribution(params)
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

/**
 * Creates a knowledge-document upload and records its ownership binding before the token is
 * returned. Failed or abandoned sessions can then be reclaimed by the knowledge-base orphan
 * sweeper without racing a later document insert.
 */
export async function createKnowledgeDocumentUploadSession(params: {
  workspaceId: string
  userId: string
  knowledgeBaseId: string
  fileName: string
  contentType: string
  fileSize: number
  metadata: Record<string, unknown>
  localOrigin: string
}): Promise<CreatedUploadSession> {
  const session = await createUploadSession({
    ...params,
    purpose: 'knowledge_document',
  })
  try {
    await recordKnowledgeBaseFileOwnership({
      key: session.storageKey,
      userId: params.userId,
      workspaceId: params.workspaceId,
      originalName: params.fileName,
      contentType: params.contentType,
      size: params.fileSize,
    })
  } catch (error) {
    await abortUploadSession(session)
    throw error
  }
  return session
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

export function knowledgeDocumentFileUrl(session: UploadSessionRecord): string {
  if (session.storageContext !== 'knowledge-base') {
    throw new Error('Knowledge-document upload has an invalid storage context')
  }
  const providerPrefix = session.storageProvider === 'local' ? '' : `${session.storageProvider}/`
  return `/api/files/serve/${providerPrefix}${encodeURIComponent(session.storageKey)}?context=knowledge-base`
}

function knowledgeDocumentInputFor(session: UploadSessionRecord) {
  const { processingOptions: _processingOptions, ...documentTags } =
    v2KnowledgeDocumentUploadMetadataSchema.parse(session.metadata)
  return {
    filename: session.fileName,
    fileUrl: knowledgeDocumentFileUrl(session),
    fileSize: session.fileSize,
    mimeType: session.contentType,
    ...documentTags,
  }
}

/**
 * Aborts an upload session, refusing once a document is bound to it.
 *
 * Upload sessions are stateless — the signed token always reconstructs as `uploading`, so this
 * guard preserves the completed state exposed by the document binding. Provider aborts must
 * also remain non-destructive after commit because an in-flight completion is not visible here
 * until its document transaction commits.
 */
export async function abortKnowledgeDocumentUpload(
  session: UploadSessionRecord,
  knowledgeBaseId: string
): Promise<UploadSessionRecord> {
  const bound = await findBoundKnowledgeDocument({
    documentId: session.id,
    knowledgeBaseId,
    document: knowledgeDocumentInputFor(session),
  })
  if (bound.status !== 'absent') {
    throw new OrchestrationError('conflict', 'Upload has already been completed')
  }
  return abortUploadSession(session)
}

/**
 * Binds a completed upload session to its knowledge document. Shared by the public v2
 * and session-authenticated routes so both get identical completion semantics.
 *
 * Ordering is load-bearing. A retry is answered from the already-bound document before any
 * work that can fail independently of the upload runs, so a payer that became unresolvable
 * after the session was created cannot turn a valid retry into an error. The ownership binding
 * is recorded before the upload token is issued, so failures retain retriable state and the
 * delayed orphan sweeper reclaims sessions that never bind to a document.
 */
export async function finalizeKnowledgeDocumentUpload(params: {
  claimed: UploadSessionRecord
  knowledgeBaseId: string
  knowledgeBaseName: string | null
  workspaceId: string
  userId: string
  resolveAttribution: () => Promise<BillingAttributionSnapshot>
  source: 'api' | 'ui'
  requestId: string
  request: NextRequest
  actorName?: string | null
  actorEmail?: string | null
}): Promise<{ value: CreatedKnowledgeDocument; completedFileId: string }> {
  const { claimed, knowledgeBaseId, workspaceId, requestId } = params
  const { processingOptions } = v2KnowledgeDocumentUploadMetadataSchema.parse(claimed.metadata)
  const document = knowledgeDocumentInputFor(claimed)

  const bound = await findBoundKnowledgeDocument({
    documentId: claimed.id,
    knowledgeBaseId,
    document,
  })
  if (bound.status === 'bound') {
    return { value: bound.document, completedFileId: bound.document.id }
  }
  if (bound.status === 'conflict') {
    throw new OrchestrationError('conflict', 'Upload id is already bound to a different document')
  }

  const billingAttribution = await params.resolveAttribution()
  const outcome = await performUploadKnowledgeDocument({
    knowledgeBase: { id: knowledgeBaseId, name: params.knowledgeBaseName, workspaceId },
    document,
    documentId: claimed.id,
    startProcessing: 'queue',
    processingOptions,
    billingAttribution,
    uploadedBy: billingAttribution.actorUserId,
    userId: params.userId,
    ...(params.actorName ? { actorName: params.actorName } : {}),
    ...(params.actorEmail ? { actorEmail: params.actorEmail } : {}),
    source: params.source,
    requestId,
    request: params.request,
  })
  if (!outcome.success) {
    throw new OrchestrationError(outcome.errorCode, outcome.error)
  }
  return { value: outcome.document, completedFileId: outcome.document.id }
}
