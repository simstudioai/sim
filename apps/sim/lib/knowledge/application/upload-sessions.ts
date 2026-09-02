import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { authorizeWorkspaceOperation, type WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  resolveActiveKnowledgeBaseContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { dispatchDocumentProcessing } from '@/lib/knowledge/documents/processing-dispatch'
import { createSingleDocument, type DocumentData } from '@/lib/knowledge/documents/service'
import type { CreatedKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import { findBoundKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import {
  type KnowledgeDocumentUploadMetadata,
  persistedKnowledgeDocumentUploadMetadataSchema,
} from '@/lib/knowledge/upload-metadata'
import { recordKnowledgeBaseFileOwnership } from '@/lib/uploads/server/metadata'
import { requestOrigin } from '@/lib/uploads/upload-session/application'
import {
  abortUploadSession,
  assertUploadSessionAuthBinding,
  completeUploadSession,
  createUploadPartUrls,
  createUploadSession,
  getPrincipalKnowledgeDocumentUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import { validateFileType } from '@/lib/uploads/utils/validation'

const logger = createLogger('KnowledgeUploadSessions')

export class KnowledgeDocumentUnsupportedMediaTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeDocumentUnsupportedMediaTypeError'
  }
}

export interface CreateKnowledgeDocumentUploadInput {
  knowledgeBaseId: string
  assertedWorkspaceId: string
  name: string
  contentType: string
  size: number
  metadata: KnowledgeDocumentUploadMetadata
}

export interface KnowledgeDocumentUploadControlInput {
  knowledgeBaseId: string
  assertedWorkspaceId: string
  uploadId: string
  uploadToken: string
}

export interface IssueKnowledgeDocumentUploadPartsInput
  extends KnowledgeDocumentUploadControlInput {
  partNumbers: number[]
}

export interface CompleteKnowledgeDocumentUploadInput extends KnowledgeDocumentUploadControlInput {
  source: 'api' | 'ui'
}

interface KnowledgeDocumentUploadCompletion {
  document: CreatedKnowledgeDocument
  created: boolean
  knowledgeBaseName: string | null
}

export interface CompleteKnowledgeDocumentUploadResult {
  session: UploadSessionRecord
  value: KnowledgeDocumentUploadCompletion
  alreadyCompleted: boolean
  workspaceId: string
  knowledgeBaseId: string
}

export const createKnowledgeDocumentUpload = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadCreate,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeDocumentUploadInput
  }) =>
    resolveActiveKnowledgeBaseContext(
      {
        knowledgeBaseId: input.knowledgeBaseId,
        assertedWorkspaceId: input.assertedWorkspaceId,
      },
      principal
    ),
  async execute({ principal, input, context, request }) {
    if (!request) throw new Error('Knowledge upload creation requires a request context')
    const billingAttribution = await resolveKnowledgeBillingAttribution(principal, context)
    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }

    const fileTypeError = validateFileType(input.name, input.contentType)
    if (fileTypeError) {
      throw new KnowledgeDocumentUnsupportedMediaTypeError(fileTypeError.message)
    }

    const storageActorUserId = resolveKnowledgeAttributedUserId(principal, context)
    const session = await createUploadSession({
      purpose: 'knowledge_document',
      workspaceId: context.workspaceId,
      knowledgeBaseId: context.knowledgeBaseId,
      userId: storageActorUserId,
      principal,
      fileName: input.name,
      contentType: input.contentType,
      fileSize: input.size,
      metadata: input.metadata,
      localOrigin: requestOrigin(request),
    })
    try {
      await recordKnowledgeBaseFileOwnership({
        key: session.storageKey,
        userId: storageActorUserId,
        workspaceId: context.workspaceId,
        originalName: input.name,
        contentType: input.contentType,
        size: input.size,
      })
    } catch (error) {
      await abortUploadSession(session)
      throw error
    }
    return session
  },
})

export const issueKnowledgeDocumentUploadParts = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadParts,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: IssueKnowledgeDocumentUploadPartsInput
  }) =>
    resolveActiveKnowledgeBaseContext(
      {
        knowledgeBaseId: input.knowledgeBaseId,
        assertedWorkspaceId: input.assertedWorkspaceId,
      },
      principal
    ),
  async execute({ principal, input, context, request }) {
    if (!request) throw new Error('Knowledge upload part issuance requires a request context')
    const session = await loadBoundKnowledgeDocumentUpload(principal, input, context)
    await reauthorizeKnowledgeDocumentUpload(principal, session, knowledgeOperations.uploadParts)
    return {
      parts: await createUploadPartUrls({
        session,
        partNumbers: input.partNumbers,
        localOrigin: requestOrigin(request),
      }),
    }
  },
})

export const cancelKnowledgeDocumentUpload = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadCancel,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: KnowledgeDocumentUploadControlInput
  }) =>
    resolveActiveKnowledgeBaseContext(
      {
        knowledgeBaseId: input.knowledgeBaseId,
        assertedWorkspaceId: input.assertedWorkspaceId,
      },
      principal
    ),
  async execute({ principal, input, context }) {
    const session = await loadBoundKnowledgeDocumentUpload(principal, input, context)
    await reauthorizeKnowledgeDocumentUpload(principal, session, knowledgeOperations.uploadCancel)
    const bound = await findBoundKnowledgeDocument({
      documentId: session.id,
      knowledgeBaseId: context.knowledgeBaseId,
      document: knowledgeDocumentInputFor(session),
    })
    if (bound.status !== 'absent') {
      throw new OrchestrationError('conflict', 'Upload has already been completed')
    }
    return abortUploadSession(session)
  },
})

export const completeKnowledgeDocumentUpload = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.uploadComplete,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CompleteKnowledgeDocumentUploadInput
  }) =>
    resolveActiveKnowledgeBaseContext(
      {
        knowledgeBaseId: input.knowledgeBaseId,
        assertedWorkspaceId: input.assertedWorkspaceId,
      },
      principal
    ),
  async execute({
    principal,
    input,
    context,
    request,
  }): Promise<CompleteKnowledgeDocumentUploadResult> {
    if (!request) throw new Error('Knowledge upload completion requires a request context')
    const session = await loadBoundKnowledgeDocumentUpload(principal, input, context)
    await reauthorizeKnowledgeDocumentUpload(principal, session, knowledgeOperations.uploadComplete)
    const requestId = generateRequestId()
    const recoveringUnprojectedRegistration =
      session.status === 'finalizing' && session.completedFileId === null
    /**
     * Filled by whichever completion branch establishes a document that still
     * needs indexing, and acted on only after the session is durably completed.
     * Registration and dispatch are two different transactions: the first must
     * commit even when the second cannot run.
     */
    let pendingDispatch: PendingProcessingDispatch | null = null
    const result = await completeUploadSession<KnowledgeDocumentUploadCompletion>({
      session,
      loadCompleted: async (claimed) => {
        const freshContext = await reauthorizeKnowledgeDocumentUpload(
          principal,
          claimed,
          knowledgeOperations.uploadComplete
        )
        const document = knowledgeDocumentInputFor(claimed)
        const bound = await findBoundKnowledgeDocument({
          documentId: claimed.id,
          knowledgeBaseId: freshContext.knowledgeBaseId,
          document,
        })
        if (bound.status === 'conflict') {
          throw new OrchestrationError(
            'conflict',
            'Upload id is already bound to a different document'
          )
        }
        if (bound.status === 'absent') {
          throw new Error('Completed knowledge upload is missing its durable document')
        }
        if (claimed.completedFileId !== bound.document.id) {
          throw new Error('Completed knowledge upload references a different durable document')
        }
        return {
          document: bound.document,
          created: false,
          knowledgeBaseName: freshContext.knowledgeBase.name,
        }
      },
      finalize: async (claimed) => {
        const freshContext = await reauthorizeKnowledgeDocumentUpload(
          principal,
          claimed,
          knowledgeOperations.uploadComplete
        )
        const { processingOptions } = knowledgeDocumentMetadataFor(claimed)
        const document = knowledgeDocumentInputFor(claimed)
        const bound = await findBoundKnowledgeDocument({
          documentId: claimed.id,
          knowledgeBaseId: freshContext.knowledgeBaseId,
          document,
        })
        if (bound.status === 'conflict') {
          throw new OrchestrationError(
            'conflict',
            'Upload id is already bound to a different document'
          )
        }
        if (bound.status === 'bound') {
          if (bound.document.processingStatus === 'pending') {
            pendingDispatch = {
              document: bound.document,
              knowledgeBaseId: freshContext.knowledgeBaseId,
              processingOptions,
              billingAttribution: await resolveKnowledgeBillingAttribution(principal, freshContext),
            }
          }
          return {
            value: {
              document: bound.document,
              created: recoveringUnprojectedRegistration,
              knowledgeBaseName: freshContext.knowledgeBase.name,
            },
            completedFileId: bound.document.id,
          }
        }

        const billingAttribution = await resolveKnowledgeBillingAttribution(principal, freshContext)
        const registrationContext = await reauthorizeKnowledgeDocumentUpload(
          principal,
          claimed,
          knowledgeOperations.uploadComplete
        )
        const uploadedBy = resolveKnowledgeAttributedUserId(principal, registrationContext)
        if (
          billingAttribution.workspaceId !== registrationContext.workspaceId ||
          billingAttribution.actorUserId !== uploadedBy ||
          billingAttribution.organizationId !== registrationContext.workspaceOrganizationId ||
          billingAttribution.billedAccountUserId !== registrationContext.billedAccountUserId
        ) {
          throw new Error('Knowledge upload billing attribution changed before registration')
        }

        let created: CreatedKnowledgeDocument
        try {
          created = await createSingleDocument(
            document,
            registrationContext.knowledgeBaseId,
            requestId,
            uploadedBy,
            claimed.id,
            undefined,
            { expectedWorkspaceId: registrationContext.workspaceId }
          )
        } catch (error) {
          const afterError = await findBoundKnowledgeDocument({
            documentId: claimed.id,
            knowledgeBaseId: registrationContext.knowledgeBaseId,
            document,
          })
          if (afterError.status === 'conflict') {
            throw new OrchestrationError(
              'conflict',
              'Upload id is already bound to a different document'
            )
          }
          if (afterError.status === 'bound') {
            return {
              value: {
                document: afterError.document,
                created: false,
                knowledgeBaseName: registrationContext.knowledgeBase.name,
              },
              completedFileId: afterError.document.id,
            }
          }
          throw error
        }

        pendingDispatch = {
          document: created,
          knowledgeBaseId: registrationContext.knowledgeBaseId,
          processingOptions,
          billingAttribution,
        }
        return {
          value: {
            document: created,
            created: true,
            knowledgeBaseName: registrationContext.knowledgeBase.name,
          },
          completedFileId: created.id,
        }
      },
    })
    if (pendingDispatch) await queueKnowledgeDocumentProcessing(pendingDispatch, requestId)
    return {
      ...result,
      workspaceId: context.workspaceId,
      knowledgeBaseId: context.knowledgeBaseId,
    }
  },
  projectAudit: ({ input, context, result }) => {
    if (!result.value.created) return []
    const { document, knowledgeBaseName } = result.value
    return {
      action: AuditAction.DOCUMENT_UPLOADED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document.id,
      resourceName: document.filename,
      description: `Uploaded document "${document.filename}" to knowledge base "${knowledgeBaseName ?? context.knowledgeBaseId}"`,
      metadata: {
        source: input.source,
        knowledgeBaseId: context.knowledgeBaseId,
        knowledgeBaseName,
        fileName: document.filename,
        fileType: document.mimeType,
        fileSize: document.fileSize,
      },
    }
  },
})

/** Everything the indexing dispatch needs, captured while the completion still holds its lease. */
interface PendingProcessingDispatch {
  document: CreatedKnowledgeDocument
  knowledgeBaseId: string
  processingOptions: KnowledgeDocumentUploadMetadata['processingOptions']
  billingAttribution: Awaited<ReturnType<typeof resolveKnowledgeBillingAttribution>>
}

/**
 * Queues indexing for a document the completion has already made durable.
 *
 * It runs after `completeUploadSession` resolves, and a failure is recorded
 * rather than raised, because by that point the caller's request has already
 * succeeded: the object is stored, the document row exists, and the session is
 * marked completed. A 500 raised after all of that has committed describes
 * nothing the caller can act on — replaying the same request answers
 * `200 completed`.
 *
 * The dispatch outcome is not lost by going unraised. `processDocumentsWithQueue`
 * marks the document `failed` with its error when processing itself breaks, and
 * {@link dispatchDocumentProcessing} records the failure on the row when the
 * dispatch never got off the ground at all. Either way the error is visible on
 * every subsequent read of the document, and the document can be re-queued
 * through `PATCH /api/knowledge/{id}/documents/{documentId}` with
 * `retryProcessing`.
 */
async function queueKnowledgeDocumentProcessing(
  dispatch: PendingProcessingDispatch,
  requestId: string
): Promise<void> {
  const processingDocument: DocumentData = {
    documentId: dispatch.document.id,
    filename: dispatch.document.filename,
    fileUrl: dispatch.document.fileUrl,
    fileSize: dispatch.document.fileSize,
    mimeType: dispatch.document.mimeType,
  }
  await dispatchDocumentProcessing({
    documents: [processingDocument],
    knowledgeBaseId: dispatch.knowledgeBaseId,
    processingOptions: dispatch.processingOptions ?? {},
    requestId,
    billingAttribution: dispatch.billingAttribution,
  })
}

async function loadBoundKnowledgeDocumentUpload(
  principal: Principal,
  input: KnowledgeDocumentUploadControlInput,
  context: ActiveKnowledgeBaseContext
): Promise<UploadSessionRecord> {
  return getPrincipalKnowledgeDocumentUploadSession({
    uploadId: input.uploadId,
    uploadToken: input.uploadToken,
    principal,
    workspaceId: context.workspaceId,
    knowledgeBaseId: context.knowledgeBaseId,
  })
}

async function reauthorizeKnowledgeDocumentUpload(
  principal: Principal,
  session: UploadSessionRecord,
  operation: WorkspaceOperation
): Promise<ActiveKnowledgeBaseContext> {
  if (
    !session.workspaceId ||
    !session.knowledgeBaseId ||
    session.purpose !== 'knowledge_document'
  ) {
    throw new OrchestrationError('not_found', 'Upload session not found')
  }
  assertUploadSessionAuthBinding(session, principal)
  const context = await resolveActiveKnowledgeBaseContext(
    {
      knowledgeBaseId: session.knowledgeBaseId,
      assertedWorkspaceId: session.workspaceId,
    },
    principal
  )
  await authorizeWorkspaceOperation(principal, operation, context, {
    delegation: knowledgeDelegationPolicy,
  })
  return context
}

/**
 * Reads metadata back off a persisted session, so it uses the lenient schema:
 * a session created before `recipe`/`lang` were constrained must still resume.
 */
function knowledgeDocumentMetadataFor(session: UploadSessionRecord) {
  const { authBinding: _authBinding, ...metadata } = session.metadata
  return persistedKnowledgeDocumentUploadMetadataSchema.parse(metadata)
}

function knowledgeDocumentInputFor(session: UploadSessionRecord) {
  const { processingOptions: _processingOptions, ...documentTags } =
    knowledgeDocumentMetadataFor(session)
  return {
    filename: session.fileName,
    fileUrl: knowledgeDocumentFileUrl(session),
    fileSize: session.fileSize,
    mimeType: session.contentType,
    ...documentTags,
  }
}

export function knowledgeDocumentFileUrl(session: UploadSessionRecord): string {
  if (session.storageContext !== 'knowledge-base') {
    throw new Error('Knowledge-document upload has an invalid storage context')
  }
  const providerPrefix = session.storageProvider === 'local' ? '' : `${session.storageProvider}/`
  return `/api/files/serve/${providerPrefix}${encodeURIComponent(session.storageKey)}?context=knowledge-base`
}
