import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeDocumentContext,
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeDocumentContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  createSingleDocument,
  type DocumentData,
  deleteKnowledgeDocumentInKnowledgeBase,
  getDocuments,
  type ProcessingOptions,
  processDocumentsWithQueue,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'

const logger = createLogger('KnowledgeDocumentApplication')

export interface ListKnowledgeDocumentsInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
  enabledFilter?: 'all' | 'enabled' | 'disabled'
  search?: string
  limit?: number
  offset?: number
  sortBy?: DocumentSortField
  sortOrder?: SortOrder
}

export interface ReadKnowledgeDocumentInput {
  knowledgeBaseId: string
  documentId: string
  assertedWorkspaceId?: string
}

export interface UploadKnowledgeDocumentAdmissionInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
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

export interface UploadKnowledgeDocumentInput extends UploadKnowledgeDocumentAdmissionInput {
  document: KnowledgeDocumentInput
  processingOptions?: ProcessingOptions
  startProcessing?: boolean
  /** Code-defined admission state; HTTP/model payloads must never populate it. */
  usageAdmission?: 'enforce' | 'pre_admitted'
  source?: string
}

export interface DeleteKnowledgeDocumentInput extends ReadKnowledgeDocumentInput {
  source?: string
}

export interface UpdateKnowledgeDocumentInput extends ReadKnowledgeDocumentInput {
  filename?: string
  enabled?: boolean
  source?: string
}

export const listKnowledgeDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listDocuments,
  resolveContext: ({ input }: { input: ListKnowledgeDocumentsInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ input, context }) {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new OrchestrationError('validation', 'Document limit must be between 1 and 100')
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new OrchestrationError('validation', 'Document offset must be a non-negative integer')
    }
    return getDocuments(
      context.knowledgeBaseId,
      {
        enabledFilter: input.enabledFilter === 'all' ? undefined : input.enabledFilter,
        search: input.search,
        limit,
        offset,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      },
      generateRequestId()
    )
  },
})

export const readKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: ({ input }: { input: ReadKnowledgeDocumentInput }) =>
    resolveActiveKnowledgeDocumentContext(input),
  async execute({ context }: { context: ActiveKnowledgeDocumentContext }) {
    return { document: context.document }
  },
})

export const admitKnowledgeDocumentUpload = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({ input }: { input: UploadKnowledgeDocumentAdmissionInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ principal, context }) {
    const billingAttribution = await resolveKnowledgeBillingAttribution(principal, context)
    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    return {
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      workspaceId: context.workspaceId,
      storageActorUserId: resolveKnowledgeAttributedUserId(principal, context),
    }
  },
})

export const uploadKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({ input }: { input: UploadKnowledgeDocumentInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ principal, input, context }) {
    if (input.document.fileSize < 0 || input.document.fileSize > MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE) {
      throw new OrchestrationError(
        'payload_too_large',
        'Knowledge document exceeds the 100MB limit'
      )
    }
    const fileTypeError = validateFileType(input.document.filename, input.document.mimeType)
    if (fileTypeError) throw new OrchestrationError('validation', fileTypeError.message)
    const billingAttribution = await resolveKnowledgeBillingAttribution(principal, context)
    if (input.usageAdmission !== 'pre_admitted') {
      const usage = await checkAttributedUsageLimits(billingAttribution)
      if (usage.isExceeded) {
        throw new KnowledgeUsageLimitExceededError(
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }
    }
    const requestId = generateRequestId()
    const uploadedBy = resolveKnowledgeAttributedUserId(principal, context)
    const document = await createSingleDocument(
      input.document,
      context.knowledgeBaseId,
      requestId,
      uploadedBy,
      undefined,
      undefined,
      { expectedWorkspaceId: context.workspaceId }
    )
    if (input.startProcessing !== false) {
      const processingDocument: DocumentData = {
        documentId: document.id,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      }
      processDocumentsWithQueue(
        [processingDocument],
        context.knowledgeBaseId,
        input.processingOptions ?? {},
        requestId,
        billingAttribution
      ).catch((error: unknown) => {
        logger.error('Knowledge document processing pipeline failed', {
          knowledgeBaseId: context.knowledgeBaseId,
          documentId: document.id,
          error,
        })
      })
    }
    return { document, created: true as const }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.DOCUMENT_UPLOADED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: result.document.id,
    resourceName: result.document.filename,
    description: `Uploaded document "${result.document.filename}" to knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      fileName: result.document.filename,
      fileType: result.document.mimeType,
      fileSize: result.document.fileSize,
    },
  }),
})

export const deleteKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteDocument,
  resolveContext: ({ input }: { input: DeleteKnowledgeDocumentInput }) =>
    resolveActiveKnowledgeDocumentContext(input),
  async execute({ context }: { context: ActiveKnowledgeDocumentContext }) {
    await deleteKnowledgeDocumentInKnowledgeBase(
      context.knowledgeBaseId,
      context.documentId,
      generateRequestId()
    )
    return {
      id: context.documentId,
      filename: context.document.filename,
      fileSize: context.document.fileSize,
      mimeType: context.document.mimeType,
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.DOCUMENT_DELETED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: result.id,
    resourceName: result.filename,
    description: `Deleted document "${result.filename}" from knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      fileName: result.filename,
      fileSize: result.fileSize,
      mimeType: result.mimeType,
    },
  }),
})

export const updateKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateDocument,
  resolveContext: ({ input }: { input: UpdateKnowledgeDocumentInput }) =>
    resolveCanonicalActiveKnowledgeDocumentContext(input),
  async execute({ input, context }) {
    const updates = { filename: input.filename, enabled: input.enabled }
    const updatedFields = Object.keys(updates).filter(
      (key) => updates[key as keyof typeof updates] !== undefined
    )
    if (updatedFields.length === 0) {
      throw new OrchestrationError('validation', 'No updates specified')
    }
    return {
      document: await updateDocument(context.documentId, updates, generateRequestId()),
      updatedFields,
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.DOCUMENT_UPDATED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: result.document.id,
    resourceName: result.document.filename,
    description: `Updated document "${result.document.filename}" in knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      fileName: result.document.filename,
      updatedFields: result.updatedFields,
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
  }),
})
