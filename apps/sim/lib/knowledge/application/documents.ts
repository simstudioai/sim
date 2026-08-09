import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { document as documentTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  BULK_DELETE_KNOWLEDGE_DOCUMENTS_COST_POLICY,
  type KnowledgeBatchExecutionResult,
  requireBoundedKnowledgeBatch,
  rethrowKnowledgeBatchTerminalFailure,
} from '@/lib/knowledge/application/batch-policy'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  type ActiveKnowledgeDocumentContext,
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeDocumentContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  bulkDocumentOperation,
  bulkDocumentOperationByFilter,
  createDocumentRecords,
  createSingleDocument,
  type DocumentData,
  deleteDocument,
  deleteKnowledgeDocumentInKnowledgeBase,
  getDocuments,
  getProcessingConfig,
  type ProcessingOptions,
  processDocumentsWithQueue,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import type { TagFilterCondition } from '@/lib/knowledge/documents/tag-filter'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import {
  performMarkKnowledgeDocumentTimedOut,
  performRetryKnowledgeDocumentProcessing,
  performUploadKnowledgeDocument,
  performUploadKnowledgeDocuments,
} from '@/lib/knowledge/orchestration/documents'
import type { KnowledgeDocumentWriteSecretProvenance } from '@/lib/knowledge/secret-provenance'
import { captureServerEvent } from '@/lib/posthog/server'
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
  tagFilters?: TagFilterCondition[]
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

export interface CreateKnowledgeDocumentsInput extends UploadKnowledgeDocumentAdmissionInput {
  documents: KnowledgeDocumentInput[]
  bulk: boolean
  processingOptions?: ProcessingOptions
  source?: 'ui' | 'api' | 'agent'
  resolveBillingAttribution?(
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof resolveKnowledgeBillingAttribution>>>
  resolveSecretProvenances(input: {
    userId: string
    workspaceId: string
  }): KnowledgeDocumentWriteSecretProvenance[] | undefined
}

export interface DeleteKnowledgeDocumentInput extends ReadKnowledgeDocumentInput {
  source?: string
}

export interface BulkDeleteKnowledgeDocumentsInput extends UploadKnowledgeDocumentAdmissionInput {
  documentIds: string[]
  cancellationSignal?: AbortSignal
  source?: string
}

interface DeletedKnowledgeDocument {
  id: string
  filename: string
  fileSize: number
  mimeType: string
}

export interface BulkDeleteKnowledgeDocumentsResult {
  knowledgeBaseId: string
  deleted: string[]
  failed: string[]
  deletedDocuments: DeletedKnowledgeDocument[]
  cancelled: boolean
}

interface BulkDeleteKnowledgeDocumentsExecutionResult
  extends BulkDeleteKnowledgeDocumentsResult,
    KnowledgeBatchExecutionResult {}

interface BulkDeleteKnowledgeDocumentsContext extends ActiveKnowledgeBaseContext {
  documentIds: string[]
}

export interface UpdateKnowledgeDocumentInput extends ReadKnowledgeDocumentInput {
  filename?: string
  enabled?: boolean
  updates?: Parameters<typeof updateDocument>[1]
  markFailedDueToTimeout?: boolean
  retryProcessing?: boolean
  resolveBillingAttribution?(
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof resolveKnowledgeBillingAttribution>>>
  source?: string
}

export interface BulkKnowledgeDocumentsInput extends UploadKnowledgeDocumentAdmissionInput {
  operation: 'enable' | 'disable' | 'delete'
  documentIds?: string[]
  selectAll?: boolean
  enabledFilter?: 'all' | 'enabled' | 'disabled'
}

export interface UpsertKnowledgeDocumentInput extends UploadKnowledgeDocumentAdmissionInput {
  documentId?: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  documentTagsData?: string
  processingOptions?: ProcessingOptions
  resolveBillingAttribution(
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof resolveKnowledgeBillingAttribution>>>
  resolveSecretProvenances(input: {
    userId: string
    workspaceId: string
  }): KnowledgeDocumentWriteSecretProvenance[] | undefined
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
    const result = await getDocuments(
      context.knowledgeBaseId,
      {
        enabledFilter: input.enabledFilter === 'all' ? undefined : input.enabledFilter,
        search: input.search,
        limit,
        offset,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        tagFilters: input.tagFilters,
      },
      generateRequestId()
    )
    return { ...result, workspaceId: context.workspaceId }
  },
})

export const readKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: ({ input }: { input: ReadKnowledgeDocumentInput }) =>
    resolveActiveKnowledgeDocumentContext(input),
  async execute({ context }: { context: ActiveKnowledgeDocumentContext }) {
    return { document: context.document, workspaceId: context.workspaceId }
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

export const createKnowledgeDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({ input }: { input: CreateKnowledgeDocumentsInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ principal, input, context, request }) {
    const billingAttribution = input.resolveBillingAttribution
      ? await input.resolveBillingAttribution(context.workspaceId)
      : await resolveKnowledgeBillingAttribution(principal, context)
    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    const userId = resolveKnowledgeAttributedUserId(principal, context)
    const secretProvenances = input.resolveSecretProvenances({
      userId,
      workspaceId: context.workspaceId,
    })
    const knowledgeBase = {
      id: context.knowledgeBaseId,
      name: context.knowledgeBase.name,
      workspaceId: context.workspaceId,
    }
    if (input.bulk) {
      const outcome = await performUploadKnowledgeDocuments({
        knowledgeBase,
        documents: input.documents,
        processingOptions: input.processingOptions,
        billingAttribution,
        uploadedBy: userId,
        secretProvenances,
        userId,
        source: input.source ?? 'ui',
        request,
      })
      if (!outcome.success) {
        if (outcome.errorCode === 'internal') throw new Error('Knowledge document creation failed')
        throw new OrchestrationError(outcome.errorCode, outcome.error)
      }
      const { batchSize, maxConcurrentDocuments } = getProcessingConfig()
      return {
        kind: 'bulk' as const,
        data: {
          total: outcome.documents.length,
          documentsCreated: outcome.documents.map((document) => ({
            documentId: document.documentId,
            filename: document.filename,
            status: 'pending' as const,
          })),
          processingMethod: 'background',
          processingConfig: {
            maxConcurrentDocuments,
            batchSize,
            totalBatches: Math.ceil(outcome.documents.length / batchSize),
          },
        },
        workspaceId: context.workspaceId,
        userId,
        secretProvenances,
      }
    }

    const document = input.documents[0]
    if (!document) throw new OrchestrationError('validation', 'No documents specified')
    const outcome = await performUploadKnowledgeDocument({
      knowledgeBase,
      document,
      billingAttribution,
      uploadedBy: userId,
      secretProvenance: secretProvenances?.[0],
      userId,
      source: input.source ?? 'ui',
      request,
    })
    if (!outcome.success) {
      if (outcome.errorCode === 'internal') throw new Error('Knowledge document creation failed')
      throw new OrchestrationError(outcome.errorCode, outcome.error)
    }
    return {
      kind: 'single' as const,
      data: outcome.document,
      workspaceId: context.workspaceId,
      userId,
      secretProvenances,
    }
  },
})

export const upsertKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({ input }: { input: UpsertKnowledgeDocumentInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ principal, input, context }) {
    const billingAttribution = await input.resolveBillingAttribution(context.workspaceId)
    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    const userId = resolveKnowledgeAttributedUserId(principal, context)
    const secretProvenances = input.resolveSecretProvenances({
      userId,
      workspaceId: context.workspaceId,
    })
    let existingDocumentId: string | null = null
    if (input.documentId) {
      const [existing] = await db
        .select({ id: documentTable.id })
        .from(documentTable)
        .where(
          and(
            eq(documentTable.id, input.documentId),
            eq(documentTable.knowledgeBaseId, context.knowledgeBaseId),
            isNull(documentTable.deletedAt)
          )
        )
        .limit(1)
      existingDocumentId = existing?.id ?? null
    } else {
      const [existing] = await db
        .select({ id: documentTable.id })
        .from(documentTable)
        .where(
          and(
            eq(documentTable.filename, input.filename),
            eq(documentTable.knowledgeBaseId, context.knowledgeBaseId),
            isNull(documentTable.deletedAt)
          )
        )
        .limit(1)
      existingDocumentId = existing?.id ?? null
    }
    const requestId = generateRequestId()
    const createdDocuments = await createDocumentRecords(
      [
        {
          filename: input.filename,
          fileUrl: input.fileUrl,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          ...(input.documentTagsData ? { documentTagsData: input.documentTagsData } : {}),
        },
      ],
      context.knowledgeBaseId,
      requestId,
      userId,
      secretProvenances
    )
    const createdDocument = createdDocuments[0]
    if (!createdDocument) throw new Error('Knowledge document upsert created no document record')
    if (existingDocumentId) {
      try {
        await deleteDocument(existingDocumentId, requestId)
      } catch (error) {
        try {
          await deleteDocument(createdDocument.documentId, requestId)
        } catch (rollbackError) {
          logger.error('Failed to remove replacement after document upsert failure', {
            knowledgeBaseId: context.knowledgeBaseId,
            documentId: createdDocument.documentId,
            rollbackError,
          })
        }
        throw new Error('Failed to replace existing document', { cause: error })
      }
    }
    processDocumentsWithQueue(
      createdDocuments,
      context.knowledgeBaseId,
      input.processingOptions ?? {},
      requestId,
      billingAttribution
    ).catch((error: unknown) => {
      logger.error('Knowledge document upsert processing pipeline failed', {
        knowledgeBaseId: context.knowledgeBaseId,
        documentId: createdDocument.documentId,
        error,
      })
    })
    const isUpdate = existingDocumentId !== null
    const { maxConcurrentDocuments, batchSize } = getProcessingConfig()
    return {
      document: createdDocument,
      isUpdate,
      previousDocumentId: existingDocumentId,
      processingConfig: { maxConcurrentDocuments, batchSize },
      workspaceId: context.workspaceId,
      userId,
      secretProvenances,
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: result.isUpdate ? AuditAction.DOCUMENT_UPDATED : AuditAction.DOCUMENT_UPLOADED,
    resourceType: AuditResourceType.DOCUMENT,
    resourceId: context.knowledgeBaseId,
    resourceName: input.filename,
    description: result.isUpdate
      ? `Upserted (replaced) document "${input.filename}" in knowledge base "${context.knowledgeBaseId}"`
      : `Upserted (created) document "${input.filename}" in knowledge base "${context.knowledgeBaseId}"`,
    metadata: {
      knowledgeBaseName: context.knowledgeBase.name,
      fileName: input.filename,
      fileType: input.mimeType,
      fileSize: input.fileSize,
      previousDocumentId: result.previousDocumentId,
      isUpdate: result.isUpdate,
    },
  }),
  afterSuccess: ({ input, context }) => {
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId: context.knowledgeBaseId,
      documentsCount: 1,
      uploadType: 'single',
      recipe: input.processingOptions?.recipe,
    })
  },
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

export const bulkDeleteKnowledgeDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkDeleteDocuments,
  async resolveContext({
    input,
  }: {
    input: BulkDeleteKnowledgeDocumentsInput
  }): Promise<BulkDeleteKnowledgeDocumentsContext> {
    const documentIds = requireBoundedKnowledgeBatch(
      input.documentIds,
      'document IDs',
      BULK_DELETE_KNOWLEDGE_DOCUMENTS_COST_POLICY.maxItems
    )
    return {
      ...(await resolveActiveKnowledgeBaseContext(input)),
      documentIds,
    }
  },
  async execute({
    principal,
    input,
    context,
  }): Promise<BulkDeleteKnowledgeDocumentsExecutionResult> {
    const deletedDocuments: DeletedKnowledgeDocument[] = []
    const failed: string[] = []
    let terminalFailure: KnowledgeBatchExecutionResult['terminalFailure']

    for (const documentId of context.documentIds) {
      if (input.cancellationSignal?.aborted) break
      try {
        const canonical = await resolveCanonicalActiveKnowledgeDocumentContext({
          knowledgeBaseId: context.knowledgeBaseId,
          documentId,
          assertedWorkspaceId: context.workspaceId,
        })
        await authorizeWorkspaceOperation(
          principal,
          knowledgeOperations.bulkDeleteDocuments,
          canonical,
          { delegation: knowledgeDelegationPolicy }
        )
        if (input.cancellationSignal?.aborted) break
        await deleteKnowledgeDocumentInKnowledgeBase(
          canonical.knowledgeBaseId,
          canonical.documentId,
          generateRequestId()
        )
        deletedDocuments.push({
          id: canonical.documentId,
          filename: canonical.document.filename,
          fileSize: canonical.document.fileSize,
          mimeType: canonical.document.mimeType,
        })
      } catch (error) {
        const classified = asOrchestrationError(error)
        if (classified && classified.code !== 'internal') {
          failed.push(documentId)
          continue
        }
        terminalFailure = { error }
        break
      }
    }

    return {
      knowledgeBaseId: context.knowledgeBaseId,
      deleted: deletedDocuments.map((document) => document.id),
      failed,
      deletedDocuments,
      cancelled: input.cancellationSignal?.aborted ?? false,
      ...(terminalFailure && { terminalFailure }),
    }
  },
  projectAudit: ({ input, context, result }) =>
    result.deletedDocuments.map((document) => ({
      action: AuditAction.DOCUMENT_DELETED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document.id,
      resourceName: document.filename,
      description: `Deleted document "${document.filename}" from knowledge base "${context.knowledgeBase.name}"`,
      metadata: {
        source: input.source,
        knowledgeBaseId: context.knowledgeBaseId,
        knowledgeBaseName: context.knowledgeBase.name,
        fileName: document.filename,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      },
    })),
  afterSuccess: ({ principal, context, result }) => {
    try {
      const userId = resolveKnowledgeAttributedUserId(principal, context)
      for (const _document of result.deletedDocuments) {
        captureServerEvent(
          userId,
          'knowledge_base_document_deleted',
          {
            knowledge_base_id: context.knowledgeBaseId,
            workspace_id: context.workspaceId,
          },
          { groups: { workspace: context.workspaceId } }
        )
      }
    } finally {
      rethrowKnowledgeBatchTerminalFailure(result)
    }
  },
})

export const updateKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateDocument,
  resolveContext: ({ input }: { input: UpdateKnowledgeDocumentInput }) =>
    resolveCanonicalActiveKnowledgeDocumentContext(input),
  async execute({ principal, input, context }) {
    if (input.markFailedDueToTimeout || input.retryProcessing) {
      const outcome = input.markFailedDueToTimeout
        ? await performMarkKnowledgeDocumentTimedOut({ document: context.document })
        : await performRetryKnowledgeDocumentProcessing({
            knowledgeBaseId: context.knowledgeBaseId,
            document: context.document,
            billingAttribution: input.resolveBillingAttribution
              ? await input.resolveBillingAttribution(context.workspaceId)
              : await resolveKnowledgeBillingAttribution(principal, context),
          })
      if (!outcome.success) {
        if (outcome.errorCode === 'internal') {
          throw new Error('Knowledge document processing operation failed')
        }
        throw new OrchestrationError(outcome.errorCode, outcome.error)
      }
      return {
        kind: 'processing' as const,
        documentId: context.documentId,
        status: outcome.status,
        message: outcome.message,
      }
    }
    const updates = input.updates ?? { filename: input.filename, enabled: input.enabled }
    const updatedFields = Object.keys(updates).filter(
      (key) => updates[key as keyof typeof updates] !== undefined
    )
    if (updatedFields.length === 0) {
      throw new OrchestrationError('validation', 'No updates specified')
    }
    return {
      kind: 'updated' as const,
      document: await updateDocument(context.documentId, updates, generateRequestId()),
      updatedFields,
    }
  },
  projectAudit: ({ input, context, result }) => {
    if (result.kind === 'processing') return []
    return {
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
    }
  },
})

export const bulkUpdateKnowledgeDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkDocuments,
  resolveContext: ({ input }: { input: BulkKnowledgeDocumentsInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ input, context }) {
    const result = input.selectAll
      ? await bulkDocumentOperationByFilter(
          context.knowledgeBaseId,
          input.operation,
          input.enabledFilter,
          generateRequestId()
        )
      : input.documentIds?.length
        ? await bulkDocumentOperation(
            context.knowledgeBaseId,
            input.operation,
            input.documentIds,
            generateRequestId()
          )
        : null
    if (!result) throw new OrchestrationError('validation', 'No documents specified')
    return {
      operation: input.operation,
      successCount: result.successCount,
      updatedDocuments: result.updatedDocuments,
    }
  },
})
