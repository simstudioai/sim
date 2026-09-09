import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { dispatchDocumentProcessing } from '@/lib/knowledge/documents/processing-dispatch'
import {
  createDocumentRecords,
  createSingleDocument,
  type DocumentData,
  deleteDocument,
  getDocumentByUploadId,
  markDocumentAsFailedTimeout,
  type ProcessingOptions,
  retryDocumentProcessing,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import {
  auditActorFields,
  classifyKnowledgeFailure,
  fail,
  type KnowledgeOperationContext,
  type KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import type { KnowledgeDocumentWriteSecretProvenance } from '@/lib/knowledge/secret-provenance'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('KnowledgeDocumentOrchestration')

/** The knowledge base a document operation targets, already authorized by the caller. */
export interface KnowledgeBaseTarget {
  id: string
  name?: string | null
  workspaceId: string | null
}

export interface KnowledgeDocumentInput {
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  documentTagsData?: string
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
}

/**
 * How the created record is handed to the indexing pipeline.
 *
 * `queue` runs the shared bounded-concurrency queue; `async` starts one
 * detached processing run. Omitted starts nothing — the internal single-document
 * route deliberately only creates the row and leaves indexing to its caller.
 */
export type KnowledgeDocumentProcessing = 'queue' | 'async'

export type CreatedKnowledgeDocument = Omit<
  Awaited<ReturnType<typeof createSingleDocument>>,
  'processingStatus'
> & {
  /** New documents are pending; idempotent completion may return a later persisted state. */
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
}

export interface PerformUploadKnowledgeDocumentParams extends KnowledgeOperationContext {
  knowledgeBase: KnowledgeBaseTarget
  document: KnowledgeDocumentInput
  startProcessing?: KnowledgeDocumentProcessing
  processingOptions?: ProcessingOptions
  billingAttribution?: BillingAttributionSnapshot
  /** Row owner recorded on the document; defaults to the acting user. */
  uploadedBy?: string | null
  /** Deterministic id carried by a stateless upload token for completion retries. */
  documentId?: string
  secretProvenance?: KnowledgeDocumentWriteSecretProvenance
  /** False when an authorized application use case projects the semantic audit. */
  recordSemanticAudit?: boolean
  /** False when the calling HTTP/tool adapter owns product analytics. */
  recordProductAnalytics?: boolean
}

export type PerformUploadKnowledgeDocumentResult = KnowledgeOrchestrationResult<{
  document: CreatedKnowledgeDocument
  created: boolean
}>

function isSameKnowledgeDocumentUpload(
  existing: CreatedKnowledgeDocument,
  document: KnowledgeDocumentInput
): boolean {
  return (
    existing.filename === document.filename &&
    existing.fileUrl === document.fileUrl &&
    existing.fileSize === document.fileSize &&
    existing.mimeType === document.mimeType
  )
}

export type BoundKnowledgeDocument =
  | { status: 'absent' }
  | { status: 'bound'; document: CreatedKnowledgeDocument }
  | { status: 'conflict' }

/**
 * Resolves what a stateless upload id is already bound to. Callers use this to answer a
 * completion retry from existing state before doing any work that can fail independently
 * of the upload — resolving a billing payer, or deleting the uploaded object.
 */
export async function findBoundKnowledgeDocument(params: {
  documentId: string
  knowledgeBaseId: string
  document: KnowledgeDocumentInput
}): Promise<BoundKnowledgeDocument> {
  const existing = await getDocumentByUploadId(params.documentId, params.knowledgeBaseId)
  if (!existing) return { status: 'absent' }
  return isSameKnowledgeDocumentUpload(existing, params.document)
    ? { status: 'bound', document: existing }
    : { status: 'conflict' }
}

function auditUpload(
  params: KnowledgeOperationContext & { knowledgeBase: KnowledgeBaseTarget },
  entry: { resourceId: string; resourceName: string; description: string; metadata: object }
) {
  recordAudit({
    workspaceId: params.knowledgeBase.workspaceId,
    ...auditActorFields(params),
    action: AuditAction.DOCUMENT_UPLOADED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: entry.resourceId,
    resourceName: entry.resourceName,
    description: entry.description,
    metadata: {
      source: params.source,
      knowledgeBaseId: params.knowledgeBase.id,
      knowledgeBaseName: params.knowledgeBase.name,
      ...entry.metadata,
    },
    ...(params.request ? { request: params.request } : {}),
  })
}

function captureUpload(
  params: KnowledgeOperationContext & { knowledgeBase: KnowledgeBaseTarget },
  documentCount: number,
  uploadType: 'single' | 'bulk'
) {
  const workspaceId = params.knowledgeBase.workspaceId
  captureServerEvent(
    params.userId,
    'knowledge_base_document_uploaded',
    {
      knowledge_base_id: params.knowledgeBase.id,
      workspace_id: workspaceId ?? '',
      document_count: documentCount,
      upload_type: uploadType,
    },
    {
      ...(workspaceId ? { groups: { workspace: workspaceId } } : {}),
      setOnce: { first_document_uploaded_at: new Date().toISOString() },
    }
  )
}

/**
 * Adds one already-resolved file to a knowledge base.
 *
 * Each surface acquires the file differently — a multipart body uploaded to
 * workspace storage, a virtual-filesystem reference resolved to a presigned URL,
 * a client-supplied URL — so acquisition stays with the caller and this takes
 * the resolved `{filename, fileUrl, fileSize, mimeType}`. Everything downstream
 * of that (the record, the indexing hand-off, telemetry, and the audit) is
 * identical for all of them, which is why the copilot path used to index
 * documents that appear nowhere in the audit log.
 */
export async function performUploadKnowledgeDocument(
  params: PerformUploadKnowledgeDocumentParams
): Promise<PerformUploadKnowledgeDocumentResult> {
  const { knowledgeBase, document, startProcessing, processingOptions, billingAttribution } = params
  const requestId = params.requestId ?? generateRequestId()

  let created: CreatedKnowledgeDocument
  if (params.documentId) {
    const bound = await findBoundKnowledgeDocument({
      documentId: params.documentId,
      knowledgeBaseId: knowledgeBase.id,
      document,
    })
    if (bound.status === 'conflict') {
      return fail('Upload id is already bound to a different document', 'conflict')
    }
    if (bound.status === 'bound') {
      return { success: true, document: bound.document, created: false }
    }
  }

  try {
    created = params.documentId
      ? await createSingleDocument(
          document,
          knowledgeBase.id,
          requestId,
          params.uploadedBy ?? params.userId,
          params.documentId,
          params.secretProvenance
        )
      : await createSingleDocument(
          document,
          knowledgeBase.id,
          requestId,
          params.uploadedBy ?? params.userId,
          undefined,
          params.secretProvenance
        )
  } catch (error) {
    if (params.documentId) {
      const bound = await findBoundKnowledgeDocument({
        documentId: params.documentId,
        knowledgeBaseId: knowledgeBase.id,
        document,
      })
      if (bound.status === 'conflict') {
        return fail('Upload id is already bound to a different document', 'conflict')
      }
      if (bound.status === 'bound') {
        return { success: true, document: bound.document, created: false }
      }
    }
    return classifyKnowledgeFailure(
      error,
      requestId,
      `Upload document "${document.filename}" to knowledge base ${knowledgeBase.id}`
    )
  }

  const documentData: DocumentData = {
    documentId: created.id,
    filename: document.filename,
    fileUrl: document.fileUrl,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
  }

  if (startProcessing === 'queue' || startProcessing === 'async') {
    void dispatchDocumentProcessing({
      documents: [documentData],
      knowledgeBaseId: knowledgeBase.id,
      processingOptions: processingOptions ?? {},
      requestId,
      billingAttribution,
    })
  }

  if (params.recordProductAnalytics !== false) {
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId: knowledgeBase.id,
      documentsCount: 1,
      uploadType: 'single',
      mimeType: document.mimeType,
      fileSize: document.fileSize,
    })
    captureUpload(params, 1, 'single')
  }

  if (params.recordSemanticAudit !== false) {
    auditUpload(params, {
      resourceId: created.id,
      resourceName: document.filename,
      description: `Uploaded document "${document.filename}" to knowledge base "${knowledgeBase.name ?? knowledgeBase.id}"`,
      metadata: {
        fileName: document.filename,
        fileType: document.mimeType,
        fileSize: document.fileSize,
      },
    })
  }

  return { success: true, document: created, created: true }
}

export interface PerformUploadKnowledgeDocumentsParams extends KnowledgeOperationContext {
  knowledgeBase: KnowledgeBaseTarget
  documents: KnowledgeDocumentInput[]
  processingOptions?: ProcessingOptions
  billingAttribution?: BillingAttributionSnapshot
  uploadedBy?: string | null
  secretProvenances?: readonly KnowledgeDocumentWriteSecretProvenance[]
  /** False when an authorized application use case projects the semantic audit. */
  recordSemanticAudit?: boolean
  /** False when the calling HTTP/tool adapter owns product analytics. */
  recordProductAnalytics?: boolean
}

export type PerformUploadKnowledgeDocumentsResult = KnowledgeOrchestrationResult<{
  documents: DocumentData[]
}>

/**
 * Adds many files to a knowledge base in one storage admission and hands the
 * whole set to the bounded-concurrency processing queue.
 *
 * Kept separate from the single-document path because `createDocumentRecords`
 * admits the batch's bytes as one unit; running it per document would let a set
 * that exceeds the quota commit its first half.
 */
export async function performUploadKnowledgeDocuments(
  params: PerformUploadKnowledgeDocumentsParams
): Promise<PerformUploadKnowledgeDocumentsResult> {
  const { knowledgeBase, documents, processingOptions, billingAttribution } = params
  const requestId = params.requestId ?? generateRequestId()

  if (documents.length === 0) {
    return fail('No documents specified', 'validation')
  }

  let created: DocumentData[]
  try {
    created = await createDocumentRecords(
      documents,
      knowledgeBase.id,
      requestId,
      params.uploadedBy ?? params.userId,
      params.secretProvenances
    )
  } catch (error) {
    return classifyKnowledgeFailure(
      error,
      requestId,
      `Upload ${documents.length} document(s) to knowledge base ${knowledgeBase.id}`
    )
  }

  logger.info(`[${requestId}] Starting controlled async processing of ${created.length} documents`)

  void dispatchDocumentProcessing({
    documents: created,
    knowledgeBaseId: knowledgeBase.id,
    processingOptions: processingOptions ?? {},
    requestId,
    billingAttribution,
  })

  if (params.recordProductAnalytics !== false) {
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId: knowledgeBase.id,
      documentsCount: created.length,
      uploadType: 'bulk',
      recipe: processingOptions?.recipe,
    })
    captureUpload(params, created.length, 'bulk')
  }

  if (params.recordSemanticAudit !== false) {
    auditUpload(params, {
      resourceId: knowledgeBase.id,
      resourceName: `${created.length} document(s)`,
      description: `Uploaded ${created.length} document(s) to knowledge base "${knowledgeBase.name ?? knowledgeBase.id}"`,
      metadata: { fileCount: created.length },
    })
  }

  return { success: true, documents: created }
}

export interface PerformUpdateKnowledgeDocumentParams extends KnowledgeOperationContext {
  knowledgeBase: KnowledgeBaseTarget
  document: { id: string; filename: string }
  updates: Parameters<typeof updateDocument>[1]
}

export type PerformUpdateKnowledgeDocumentResult = KnowledgeOrchestrationResult<{
  document: Awaited<ReturnType<typeof updateDocument>>
}>

/** Renames a document, toggles it, or edits its tags, and records the change. */
export async function performUpdateKnowledgeDocument(
  params: PerformUpdateKnowledgeDocumentParams
): Promise<PerformUpdateKnowledgeDocumentResult> {
  const { knowledgeBase, document, updates, request, source } = params
  const requestId = params.requestId ?? generateRequestId()

  const updatedFields = Object.keys(updates).filter(
    (key) => updates[key as keyof typeof updates] !== undefined
  )
  if (updatedFields.length === 0) {
    return fail('No updates specified', 'validation')
  }

  let updated: Awaited<ReturnType<typeof updateDocument>>
  try {
    updated = await updateDocument(document.id, updates, requestId)
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Update document ${document.id}`)
  }

  const filename = updates.filename ?? document.filename

  recordAudit({
    workspaceId: knowledgeBase.workspaceId,
    ...auditActorFields(params),
    action: AuditAction.DOCUMENT_UPDATED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: document.id,
    resourceName: filename,
    description: `Updated document "${filename}" in knowledge base "${knowledgeBase.name ?? knowledgeBase.id}"`,
    metadata: {
      source,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBaseName: knowledgeBase.name,
      fileName: filename,
      updatedFields,
      ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    },
    ...(request ? { request } : {}),
  })

  return { success: true, document: updated }
}

export interface PerformDeleteKnowledgeDocumentParams extends KnowledgeOperationContext {
  knowledgeBase: KnowledgeBaseTarget
  document: { id: string; filename: string; fileSize?: number; mimeType?: string }
}

export type PerformDeleteKnowledgeDocumentResult = KnowledgeOrchestrationResult

/** Deletes a document and its embeddings, and records the deletion. */
export async function performDeleteKnowledgeDocument(
  params: PerformDeleteKnowledgeDocumentParams
): Promise<PerformDeleteKnowledgeDocumentResult> {
  const { knowledgeBase, document, request, source } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    await deleteDocument(document.id, requestId)
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Delete document ${document.id}`)
  }

  logger.info(
    `[${requestId}] Deleted document ${document.id} from knowledge base ${knowledgeBase.id}`
  )

  recordAudit({
    workspaceId: knowledgeBase.workspaceId,
    ...auditActorFields(params),
    action: AuditAction.DOCUMENT_DELETED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: document.id,
    resourceName: document.filename,
    description: `Deleted document "${document.filename}" from knowledge base "${knowledgeBase.name ?? knowledgeBase.id}"`,
    metadata: {
      source,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBaseName: knowledgeBase.name,
      fileName: document.filename,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
    },
    ...(request ? { request } : {}),
  })

  const workspaceId = knowledgeBase.workspaceId
  captureServerEvent(
    params.userId,
    'knowledge_base_document_deleted',
    { knowledge_base_id: knowledgeBase.id, workspace_id: workspaceId ?? '' },
    workspaceId ? { groups: { workspace: workspaceId } } : undefined
  )

  return { success: true }
}

export interface PerformMarkKnowledgeDocumentTimedOutParams {
  knowledgeBaseId: string
  document: {
    id: string
    processingStatus: string
    processingStartedAt?: Date | null
  }
  requestId?: string
}

export type PerformKnowledgeDocumentProcessingResult = KnowledgeOrchestrationResult<{
  status: string
  message: string
}>

/**
 * Marks a document whose processing run died as failed. Not audited: the state
 * change is the system conceding a run it lost, not a user editing a document.
 */
export async function performMarkKnowledgeDocumentTimedOut(
  params: PerformMarkKnowledgeDocumentTimedOutParams
): Promise<PerformKnowledgeDocumentProcessingResult> {
  const { document, knowledgeBaseId } = params
  const requestId = params.requestId ?? generateRequestId()

  if (document.processingStatus !== 'processing') {
    return fail(
      `Document is not in processing state (current: ${document.processingStatus})`,
      'validation'
    )
  }
  if (!document.processingStartedAt) {
    return fail('Document has no processing start time', 'validation')
  }

  try {
    const result = await markDocumentAsFailedTimeout(
      knowledgeBaseId,
      document.id,
      document.processingStartedAt,
      requestId
    )
    if (!result.success) {
      return fail(
        'Document processing attempt changed before timeout could be recorded',
        'conflict'
      )
    }
  } catch (error) {
    // The service rejects a document that has not been processing long enough
    // to be presumed dead; that is a caller-fixable "try again later", not a fault.
    if (!(error instanceof OrchestrationError)) {
      return fail(toError(error).message, 'validation')
    }
    return classifyKnowledgeFailure(error, requestId, `Time out document ${document.id}`)
  }

  return { success: true, status: 'failed', message: 'Document marked as failed due to timeout' }
}

export interface PerformRetryKnowledgeDocumentParams {
  knowledgeBaseId: string
  document: {
    id: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    processingStatus: string
    connectorId?: string | null
    contentHash?: string | null
  }
  billingAttribution?: BillingAttributionSnapshot
  requestId?: string
}

/** Re-queues a failed document for indexing. Not audited: no document state a user chose changes. */
export async function performRetryKnowledgeDocumentProcessing(
  params: PerformRetryKnowledgeDocumentParams
): Promise<PerformKnowledgeDocumentProcessingResult> {
  const { knowledgeBaseId, document, billingAttribution } = params
  const requestId = params.requestId ?? generateRequestId()

  if (document.connectorId && document.contentHash === null) {
    return fail(
      'Source content could not be downloaded. Sync the connector to retry.',
      'validation'
    )
  }

  /**
   * `pending` is admitted alongside `failed`, and the decision is left to the
   * guarded requeue itself.
   *
   * A worker killed before its claim UPDATE burns a processing attempt without
   * moving the document off `pending`, and once its attempt budget is spent the
   * connector sweep stops taking it too. Rejecting `pending` here made that row
   * unrecoverable from every surface. Whether it is old enough to be certainly
   * abandoned is a race-sensitive question the requeue answers in SQL against
   * the same grace the sweep uses; this check only rejects the states no retry
   * can ever apply to.
   */
  if (document.processingStatus !== 'failed' && document.processingStatus !== 'pending') {
    return fail(
      `Document is not in a retryable state (current: ${document.processingStatus})`,
      'validation'
    )
  }

  try {
    const result = await retryDocumentProcessing(
      knowledgeBaseId,
      document.id,
      {
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      },
      requestId,
      billingAttribution
    )
    // Forwarded rather than hard-coded to `true`: a retry whose dispatch never
    // got off the ground leaves a dead document, and reporting that as success
    // paints the UI green over it.
    if (!result.success) {
      return fail(result.message, 'internal')
    }
    return { success: true, status: result.status, message: result.message }
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Retry document ${document.id}`)
  }
}
