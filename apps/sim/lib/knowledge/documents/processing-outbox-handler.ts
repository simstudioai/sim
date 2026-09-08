import { assertBillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { env, envNumber } from '@/lib/core/config/env'
import {
  type OutboxHandler,
  type OutboxHandlerRegistry,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'
import { isBYOKEmbeddingCredentialRejection, isEmbeddingQuotaExhaustion } from '@/lib/embeddings'
import { SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import {
  getOcrRequestRejection,
  isPermanentDocumentProcessingError,
  isUsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import {
  cleanupEmbeddingCheckpoint,
  EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/embedding-checkpoints'
import {
  cleanupOcrCheckpoint,
  OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
} from '@/lib/knowledge/documents/ocr-checkpoints'
import { reclaimStaleDocumentProcessingClaim } from '@/lib/knowledge/documents/processing-claim'
import { KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-continuation-dispatch'
import {
  KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT,
  type KnowledgeDocumentProcessingOutboxPayload,
} from '@/lib/knowledge/documents/processing-outbox-event'
import {
  assertDocumentProcessingPayload,
  shouldRefundDocumentProcessingPredecessor,
} from '@/lib/knowledge/documents/processing-payload'
import { scheduleDocumentProcessingProviderContinuation } from '@/lib/knowledge/documents/processing-provider-continuation'
import {
  getProviderCapacityDeferral,
  ProviderCapacityContinuationExhaustedError,
} from '@/lib/knowledge/documents/processing-provider-deferral'
import {
  canScheduleDocumentProcessingQuotaContinuation,
  scheduleDocumentProcessingQuotaContinuation,
} from '@/lib/knowledge/documents/processing-quota-continuation'
import {
  getKnowledgeDocument,
  type ProcessingOptions,
  processDocumentAsync,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import {
  cleanupKnowledgeStorage,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/storage-cleanup'

function requirePayloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Knowledge document processing outbox payload must be an object')
  }
  return payload as Record<string, unknown>
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Knowledge document processing outbox payload is missing ${field}`)
  }
  return value
}

function parseProcessingOptions(value: unknown): ProcessingOptions {
  const record = requirePayloadRecord(value)
  const unsupported = Object.keys(record).filter((key) => key !== 'recipe' && key !== 'lang')
  if (unsupported.length > 0) {
    throw new Error(
      `Knowledge document processing outbox payload has unsupported processing options: ${unsupported.join(', ')}`
    )
  }
  if (record.recipe !== undefined && typeof record.recipe !== 'string') {
    throw new Error('Knowledge document processing outbox recipe must be a string')
  }
  if (record.lang !== undefined && typeof record.lang !== 'string') {
    throw new Error('Knowledge document processing outbox lang must be a string')
  }
  return {
    ...(record.recipe !== undefined ? { recipe: record.recipe } : {}),
    ...(record.lang !== undefined ? { lang: record.lang } : {}),
  }
}

function parsePayload(payload: unknown): KnowledgeDocumentProcessingOutboxPayload {
  const record = requirePayloadRecord(payload)
  return {
    knowledgeBaseId: requireNonEmptyString(record.knowledgeBaseId, 'knowledgeBaseId'),
    documentId: requireNonEmptyString(record.documentId, 'documentId'),
    processingOptions: parseProcessingOptions(record.processingOptions),
    billingAttribution: assertBillingAttributionSnapshot(record.billingAttribution),
  }
}

const processKnowledgeDocument: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = parsePayload(rawPayload)
  context.signal.throwIfAborted()
  /** A background job processing the row it was dispatched for; no principal is involved. */
  const document = await getKnowledgeDocument(
    payload.knowledgeBaseId,
    payload.documentId,
    SYSTEM_ACCESS_SCOPE
  )
  if (!document || document.processingStatus === 'completed') return
  if (document.processingStatus === 'processing') {
    const reclaimed = await reclaimStaleDocumentProcessingClaim({
      knowledgeBaseId: payload.knowledgeBaseId,
      documentId: document.id,
      processingStartedAt: document.processingStartedAt,
    })
    if (!reclaimed) {
      throw new Error(`Knowledge document ${document.id} is already being processed`)
    }
  }

  context.signal.throwIfAborted()
  const dispatch = await processDocumentsWithQueue(
    [
      {
        documentId: document.id,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      },
    ],
    payload.knowledgeBaseId,
    payload.processingOptions,
    context.eventId,
    payload.billingAttribution,
    undefined,
    { signal: context.signal, deadlineAt: context.deadlineAt }
  )
  context.signal.throwIfAborted()
  if (dispatch.failed > 0 || dispatch.accepted !== 1) {
    throw new Error(`Knowledge document ${document.id} processing dispatch was not accepted`)
  }
}

/** Resumes the saved indexing generation without admitting or billing a new pass. */
const resumeKnowledgeDocument: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = assertDocumentProcessingPayload(rawPayload)
  context.signal.throwIfAborted()
  try {
    await processDocumentAsync(
      payload.knowledgeBaseId,
      payload.documentId,
      payload.docData,
      payload.processingOptions,
      payload,
      payload.requestId,
      {
        chargedAtDispatch: false,
        processingQueueToken: payload.processingQueueToken,
        processingPredecessorToken: payload.processingPredecessorToken,
        refundPredecessorAdmission: shouldRefundDocumentProcessingPredecessor(payload),
        ...(payload.processingQueuedAt
          ? { processingQueuedAt: new Date(payload.processingQueuedAt) }
          : {}),
        ...(canScheduleDocumentProcessingQuotaContinuation(payload)
          ? {
              scheduleQuotaContinuation: () =>
                scheduleDocumentProcessingQuotaContinuation(payload, false),
            }
          : { quotaContinuationExhausted: true }),
        scheduleProviderContinuation: (error) =>
          scheduleDocumentProcessingProviderContinuation(payload, error, false),
        signal: context.signal,
        deadlineAt: context.deadlineAt,
      }
    )
  } catch (error) {
    context.signal.throwIfAborted()
    if (
      getProviderCapacityDeferral(error) ||
      error instanceof ProviderCapacityContinuationExhaustedError ||
      isEmbeddingQuotaExhaustion(error) ||
      isBYOKEmbeddingCredentialRejection(error) ||
      getOcrRequestRejection(error) ||
      isPermanentDocumentProcessingError(error) ||
      isUsageLimitDocumentProcessingError(error)
    )
      return
    throw error
  }
}

const KNOWLEDGE_HANDLER_TIMEOUT_MS = Math.min(
  550_000,
  Math.max(1, envNumber(env.KB_CONFIG_MAX_DURATION, 600) * 1000 - 30_000)
)

export const knowledgeDocumentProcessingOutboxHandlers = {
  [KNOWLEDGE_STORAGE_CLEANUP_EVENT]: cleanupKnowledgeStorage,
  [OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT]: cleanupOcrCheckpoint,
  [EMBEDDING_CHECKPOINT_CLEANUP_EVENT]: cleanupEmbeddingCheckpoint,
  [KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT]: withOutboxHandlerTimeout(
    processKnowledgeDocument,
    KNOWLEDGE_HANDLER_TIMEOUT_MS
  ),
  [KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT]: withOutboxHandlerTimeout(
    resumeKnowledgeDocument,
    KNOWLEDGE_HANDLER_TIMEOUT_MS
  ),
} satisfies OutboxHandlerRegistry
