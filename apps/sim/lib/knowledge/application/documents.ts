import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document as documentTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
} from '@/lib/billing/core/billing-attribution'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
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
  resolveKnowledgeUsageAdmission,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeDocumentContext,
  type ActiveKnowledgeResourceBaseContext,
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeDocumentContext,
  resolveActiveKnowledgeResourceContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  ALL_TAG_SLOTS,
  type AllTagSlot,
  MAX_KNOWLEDGE_DOCUMENTS_PER_CREATE,
} from '@/lib/knowledge/constants'
import { dispatchDocumentProcessing } from '@/lib/knowledge/documents/processing-dispatch'
import {
  bulkDocumentOperation,
  bulkDocumentOperationByFilter,
  createDocumentRecords,
  createSingleDocument,
  deleteDocument,
  deleteKnowledgeDocumentInKnowledgeBase,
  getDocuments,
  getProcessingConfig,
  type ProcessingOptions,
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
import {
  type KnowledgeTagNameFilter,
  resolveKnowledgeTagFilters,
  toKnowledgeTagFilterConditions,
} from '@/lib/knowledge/tags/filter-resolution'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { validateTagValue } from '@/lib/knowledge/tags/utils'
import { StorageService } from '@/lib/uploads'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import { recordKnowledgeBaseFileOwnership } from '@/lib/uploads/server/metadata'
import {
  EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE,
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
} from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'

const logger = createLogger('KnowledgeDocumentApplication')

export interface ListKnowledgeDocumentsInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
  enabledFilter?: 'all' | 'enabled' | 'disabled'
  search?: string
  limit?: number
  offset?: number
  sortBy?: DocumentSortField
  sortOrder?: SortOrder
  /** Slot-addressed filters, as first-party surfaces already build them. */
  tagFilters?: TagFilterCondition[]
  /**
   * Display-name-addressed filters, resolved to slots here against the
   * knowledge base's own tag definitions. Public surfaces send these so that
   * document filtering and search speak one tag vocabulary.
   */
  tagNameFilters?: KnowledgeTagNameFilter[]
}

export interface ReadKnowledgeDocumentInput {
  knowledgeBaseId: string
  documentId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
  /** Search surfaces exclude disabled documents; management can still inspect them. */
  requireEnabledDocument?: boolean
}

export interface UploadKnowledgeDocumentAdmissionInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
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
  file: {
    buffer: Buffer
    filename: string
    fileSize: number
    mimeType: string
  }
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
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
  resolveSecretProvenances(input: {
    userId: string
    workspaceId?: string
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

type BulkDeleteKnowledgeDocumentsContext = ActiveKnowledgeResourceBaseContext & {
  documentIds: string[]
}

export interface UpdateKnowledgeDocumentInput extends ReadKnowledgeDocumentInput {
  filename?: string
  enabled?: boolean
  tagValues?: KnowledgeDocumentTagValueAssignment[]
  updates?: Parameters<typeof updateDocument>[1]
  markFailedDueToTimeout?: boolean
  retryProcessing?: boolean
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
  source?: string
}

export interface KnowledgeDocumentTagValueAssignment {
  tagDefinitionId: string
  value: string | number | boolean | null
}

type KnowledgeDocumentUpdates = Parameters<typeof updateDocument>[1]

function isAllTagSlot(tagSlot: string): tagSlot is AllTagSlot {
  return (ALL_TAG_SLOTS as readonly string[]).includes(tagSlot)
}

async function resolveKnowledgeDocumentTagValueUpdates(
  knowledgeBaseId: string,
  tagValues: readonly KnowledgeDocumentTagValueAssignment[]
): Promise<KnowledgeDocumentUpdates> {
  const definitions = await getDocumentTagDefinitions(knowledgeBaseId)
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const seenDefinitionIds = new Set<string>()
  const updates: KnowledgeDocumentUpdates = {}

  for (const assignment of tagValues) {
    if (seenDefinitionIds.has(assignment.tagDefinitionId)) {
      throw new OrchestrationError(
        'validation',
        `Duplicate tag definition ID: ${assignment.tagDefinitionId}`
      )
    }
    seenDefinitionIds.add(assignment.tagDefinitionId)

    const definition = definitionsById.get(assignment.tagDefinitionId)
    if (!definition) {
      throw new OrchestrationError(
        'validation',
        `Tag definition ${assignment.tagDefinitionId} does not belong to this knowledge base`
      )
    }
    if (!isAllTagSlot(definition.tagSlot)) {
      throw new Error(`Tag definition ${definition.id} has an unsupported slot`)
    }

    if (assignment.value === null) {
      updates[definition.tagSlot] = ''
      continue
    }

    const value = String(assignment.value).trim()
    if (!value) {
      throw new OrchestrationError(
        'validation',
        `Tag "${definition.displayName}" requires a value; use null to clear it`
      )
    }
    const validationError = validateTagValue(definition.displayName, value, definition.fieldType)
    if (validationError) {
      throw new OrchestrationError('validation', validationError)
    }
    updates[definition.tagSlot] = value
  }

  return updates
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
  resolveBillingAttribution(workspaceId: string): Promise<BillingAttributionSnapshot>
  resolveSecretProvenances(input: {
    userId: string
    workspaceId?: string
  }): KnowledgeDocumentWriteSecretProvenance[] | undefined
}

/**
 * Lists documents, resolving any display-named tag filters against the
 * knowledge base's tag definitions. The definitions are returned with the page
 * so a presenter can key each document's tag values by display name — the same
 * projection knowledge search performs — without reading protected data itself.
 */
export const listKnowledgeDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listDocuments,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ListKnowledgeDocumentsInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ input, context }) {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new OrchestrationError('validation', 'Document limit must be between 1 and 100')
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new OrchestrationError('validation', 'Document offset must be a non-negative integer')
    }
    const resolvedNameFilters = input.tagNameFilters?.length
      ? await resolveKnowledgeTagFilters(input.tagNameFilters, [context.knowledgeBaseId])
      : null
    const tagFilters = [
      ...(input.tagFilters ?? []),
      ...(resolvedNameFilters
        ? toKnowledgeTagFilterConditions(resolvedNameFilters.structuredFilters)
        : []),
    ]
    const result = await getDocuments(
      context.knowledgeBaseId,
      {
        enabledFilter: input.enabledFilter === 'all' ? undefined : input.enabledFilter,
        search: input.search,
        limit,
        offset,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        tagFilters: tagFilters.length > 0 ? tagFilters : undefined,
      },
      generateRequestId(),
      await context.access.get()
    )
    return {
      ...result,
      tagDefinitions:
        resolvedNameFilters?.definitionsByKnowledgeBase.get(context.knowledgeBaseId) ??
        (await getDocumentTagDefinitions(context.knowledgeBaseId)),
      workspaceId: context.workspaceId,
    }
  },
})

export const readKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadKnowledgeDocumentInput
  }) => resolveActiveKnowledgeDocumentContext(input, principal),
  async execute({ input, context }) {
    if (input.requireEnabledDocument && !context.document.enabled) {
      throw new OrchestrationError('not_found', 'Document not found')
    }
    return {
      document: context.document,
      tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId),
      workspaceId: context.workspaceId,
    }
  },
})

export const admitKnowledgeDocumentUpload = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UploadKnowledgeDocumentAdmissionInput
  }) => resolveActiveKnowledgeBaseContext(input, principal),
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
    }
  },
})

export const uploadKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UploadKnowledgeDocumentInput
  }) => resolveActiveKnowledgeBaseContext(input, principal),
  async execute({ principal, input, context }) {
    if (input.file.fileSize < 0 || input.file.fileSize > MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE) {
      throw new OrchestrationError(
        'payload_too_large',
        'Knowledge document exceeds the 100MB limit'
      )
    }
    if (input.file.fileSize !== input.file.buffer.byteLength) {
      throw new Error('Knowledge document upload size does not match its buffered bytes')
    }
    if (input.file.fileSize === 0) {
      throw new OrchestrationError('validation', EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE)
    }
    const fileTypeError = validateFileType(input.file.filename, input.file.mimeType)
    if (fileTypeError) throw new OrchestrationError('validation', fileTypeError.message)
    if (input.usageAdmission !== 'pre_admitted') {
      const billingAttribution = await resolveKnowledgeBillingAttribution(principal, context)
      const usage = await checkAttributedUsageLimits(billingAttribution)
      if (usage.isExceeded) {
        throw new KnowledgeUsageLimitExceededError(
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }
    }
    const requestId = generateRequestId()
    const storageActorUserId = resolveKnowledgeAttributedUserId(principal, context)
    const storageKey = generateKnowledgeBaseFileKey(input.file.filename)
    await recordKnowledgeBaseFileOwnership({
      key: storageKey,
      userId: storageActorUserId,
      workspaceId: context.workspaceId,
      originalName: input.file.filename,
      contentType: input.file.mimeType,
      size: input.file.fileSize,
    })
    const storedFile = await StorageService.uploadFile({
      file: input.file.buffer,
      fileName: input.file.filename,
      contentType: input.file.mimeType,
      context: 'knowledge-base',
      customKey: storageKey,
      preserveKey: true,
      persistMetadata: false,
    })
    if (storedFile.key !== storageKey || storedFile.size !== input.file.fileSize) {
      throw new Error('Knowledge document storage did not preserve the admitted file identity')
    }
    if (storedFile.path.includes('?')) {
      throw new Error('Knowledge document storage returned a path with an unexpected query')
    }

    const registrationContext = await resolveActiveKnowledgeBaseContext(input, principal)
    await authorizeWorkspaceOperation(
      principal,
      knowledgeOperations.uploadDocument,
      registrationContext,
      {
        delegation: knowledgeDelegationPolicy,
      }
    )
    const billingAttribution = await resolveKnowledgeBillingAttribution(
      principal,
      registrationContext
    )
    const uploadedBy = resolveKnowledgeAttributedUserId(principal, registrationContext)
    const documentInput: KnowledgeDocumentInput = {
      filename: input.file.filename,
      fileUrl: `${storedFile.path}?context=knowledge-base`,
      fileSize: input.file.fileSize,
      mimeType: input.file.mimeType,
    }
    const document = await createSingleDocument(
      documentInput,
      registrationContext.knowledgeBaseId,
      requestId,
      uploadedBy,
      undefined,
      undefined,
      {
        expectedWorkspaceId: registrationContext.workspaceId,
        ...(input.startProcessing !== false
          ? {
              processing: {
                processingOptions: input.processingOptions ?? {},
                billingAttribution,
              },
            }
          : {}),
      }
    )
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
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeDocumentsInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ principal, input, context, request }) {
    if (input.documents.length === 0) {
      throw new OrchestrationError('validation', 'No documents specified')
    }
    if (input.documents.length > MAX_KNOWLEDGE_DOCUMENTS_PER_CREATE) {
      throw new OrchestrationError(
        'validation',
        `At most ${MAX_KNOWLEDGE_DOCUMENTS_PER_CREATE} documents may be created at once`
      )
    }
    const { billingAttribution, usage, userId } = await resolveKnowledgeUsageAdmission(
      principal,
      context,
      input.resolveBillingAttribution
    )
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    const secretProvenances = input.resolveSecretProvenances({
      userId,
      workspaceId: context.workspaceId,
    })
    const knowledgeBase = {
      id: context.knowledgeBaseId,
      name: context.knowledgeBase.name,
      workspaceId: context.workspaceId ?? null,
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
        recordSemanticAudit: false,
        recordProductAnalytics: false,
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
        knowledgeBaseId: context.knowledgeBaseId,
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
      recordSemanticAudit: false,
      recordProductAnalytics: false,
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
  projectAudit: ({ input, context, result }) => {
    if (result.kind === 'bulk') {
      return {
        action: AuditAction.DOCUMENT_UPLOADED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: context.knowledgeBaseId,
        resourceName: `${result.data.total} document(s)`,
        description: `Uploaded ${result.data.total} document(s) to knowledge base "${context.knowledgeBase.name}"`,
        metadata: {
          source: input.source,
          knowledgeBaseId: context.knowledgeBaseId,
          knowledgeBaseName: context.knowledgeBase.name,
          fileCount: result.data.total,
        },
      }
    }
    return {
      action: AuditAction.DOCUMENT_UPLOADED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: result.data.id,
      resourceName: result.data.filename,
      description: `Uploaded document "${result.data.filename}" to knowledge base "${context.knowledgeBase.name}"`,
      metadata: {
        source: input.source,
        knowledgeBaseId: context.knowledgeBaseId,
        knowledgeBaseName: context.knowledgeBase.name,
        fileName: result.data.filename,
        fileType: result.data.mimeType,
        fileSize: result.data.fileSize,
      },
    }
  },
})

export const upsertKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpsertKnowledgeDocumentInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ principal, input, context }) {
    const { billingAttribution, usage, userId } = await resolveKnowledgeUsageAdmission(
      principal,
      context,
      input.resolveBillingAttribution
    )
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    const secretProvenances = input.resolveSecretProvenances({
      userId,
      workspaceId: context.workspaceId,
    })
    /**
     * Only a document the caller may read counts as the one being replaced:
     * a restricted document is neither confirmed to exist nor replaced.
     */
    const access = await context.access.get()
    let existingDocumentId: string | null = null
    if (input.documentId) {
      const [existing] = await db
        .select({ id: documentTable.id })
        .from(documentTable)
        .where(
          and(
            eq(documentTable.id, input.documentId),
            eq(documentTable.knowledgeBaseId, context.knowledgeBaseId),
            isNull(documentTable.deletedAt),
            knowledgeAccessCondition(access)
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
            isNull(documentTable.deletedAt),
            knowledgeAccessCondition(access)
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
        await deleteKnowledgeDocumentInKnowledgeBase(
          context.knowledgeBaseId,
          existingDocumentId,
          requestId,
          access
        )
      } catch (error) {
        /**
         * The previous document went away — or out of the caller's reach —
         * between the lookup and the delete. The replacement is an ordinary
         * upload the caller may make, so it stays.
         */
        if (error instanceof OrchestrationError && error.code === 'not_found') {
          logger.warn('Document being replaced was no longer visible; keeping the replacement', {
            knowledgeBaseId: context.knowledgeBaseId,
            previousDocumentId: existingDocumentId,
          })
          existingDocumentId = null
        } else {
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
    }
    void dispatchDocumentProcessing({
      documents: createdDocuments,
      knowledgeBaseId: context.knowledgeBaseId,
      processingOptions: input.processingOptions ?? {},
      requestId,
      billingAttribution,
    })
    const isUpdate = existingDocumentId !== null
    const { maxConcurrentDocuments, batchSize } = getProcessingConfig()
    return {
      document: createdDocument,
      knowledgeBaseId: context.knowledgeBaseId,
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
})

export const deleteKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: DeleteKnowledgeDocumentInput
  }) => resolveActiveKnowledgeDocumentContext(input, principal),
  async execute({ context }: { context: ActiveKnowledgeDocumentContext }) {
    await deleteKnowledgeDocumentInKnowledgeBase(
      context.knowledgeBaseId,
      context.documentId,
      generateRequestId(),
      await context.access.get()
    )
    return {
      id: context.documentId,
      knowledgeBaseId: context.knowledgeBaseId,
      workspaceId: context.workspaceId,
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
    principal,
    input,
  }: {
    principal: Principal
    input: BulkDeleteKnowledgeDocumentsInput
  }): Promise<BulkDeleteKnowledgeDocumentsContext> {
    const documentIds = requireBoundedKnowledgeBatch(
      input.documentIds,
      'document IDs',
      BULK_DELETE_KNOWLEDGE_DOCUMENTS_COST_POLICY.maxItems
    )
    return {
      ...(await resolveActiveKnowledgeResourceContext(input, principal)),
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
        const canonical = await resolveCanonicalActiveKnowledgeDocumentContext(
          {
            knowledgeBaseId: context.knowledgeBaseId,
            documentId,
            assertedWorkspaceId: context.workspaceId,
          },
          principal
        )
        if (canonical.workspaceId) {
          await authorizeWorkspaceOperation(
            principal,
            knowledgeOperations.bulkDeleteDocuments,
            canonical,
            { delegation: knowledgeDelegationPolicy }
          )
        }
        if (input.cancellationSignal?.aborted) break
        await deleteKnowledgeDocumentInKnowledgeBase(
          canonical.knowledgeBaseId,
          canonical.documentId,
          generateRequestId(),
          await context.access.get()
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
  afterSuccess: ({ result }) => rethrowKnowledgeBatchTerminalFailure(result),
})

export const updateKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateDocument,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeDocumentInput
  }) => resolveCanonicalActiveKnowledgeDocumentContext(input, principal),
  async execute({ principal, input, context }) {
    if (input.markFailedDueToTimeout || input.retryProcessing) {
      const outcome = input.markFailedDueToTimeout
        ? await performMarkKnowledgeDocumentTimedOut({
            knowledgeBaseId: context.knowledgeBaseId,
            document: context.document,
          })
        : await performRetryKnowledgeDocumentProcessing({
            knowledgeBaseId: context.knowledgeBaseId,
            document: context.document,
            billingAttribution: (
              await resolveKnowledgeUsageAdmission(
                principal,
                context,
                input.resolveBillingAttribution
              )
            ).billingAttribution,
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
    const updates: KnowledgeDocumentUpdates = input.updates
      ? { ...input.updates }
      : { filename: input.filename, enabled: input.enabled }
    if (input.tagValues !== undefined) {
      Object.assign(
        updates,
        await resolveKnowledgeDocumentTagValueUpdates(context.knowledgeBaseId, input.tagValues)
      )
    }
    const updatedFields = Object.keys(updates).filter(
      (key) => updates[key as keyof typeof updates] !== undefined
    )
    if (updatedFields.length === 0) {
      throw new OrchestrationError('validation', 'No updates specified')
    }
    return {
      kind: 'updated' as const,
      document: await updateDocument(context.documentId, updates, generateRequestId()),
      tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId),
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
        ...(input.tagValues !== undefined && {
          tagDefinitionIds: input.tagValues.map((assignment) => assignment.tagDefinitionId),
        }),
      },
    }
  },
})

export const bulkUpdateKnowledgeDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkDocuments,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: BulkKnowledgeDocumentsInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ input, context }) {
    const result = input.selectAll
      ? await bulkDocumentOperationByFilter(
          context.knowledgeBaseId,
          input.operation,
          input.enabledFilter,
          await context.access.get(),
          generateRequestId()
        )
      : input.documentIds?.length
        ? await bulkDocumentOperation(
            context.knowledgeBaseId,
            input.operation,
            input.documentIds,
            await context.access.get(),
            generateRequestId()
          )
        : null
    if (!result) throw new OrchestrationError('validation', 'No documents specified')
    return {
      operation: input.operation,
      successCount: result.successCount,
      updatedDocuments: result.updatedDocuments,
      /**
       * Reported so a surface can tell a bounded selection from an unbounded
       * one: `documentIds` is capped by the request, `selectAll` is capped by
       * nothing, and a presenter that echoes the identifiers either way returns
       * a multi-megabyte array on a large knowledge base.
       */
      selectAll: input.selectAll === true,
    }
  },
})
