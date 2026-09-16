import { isRecordLike } from '@sim/utils/object'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'

export interface DocumentProcessingPayloadBase {
  knowledgeBaseId: string
  documentId: string
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }
  processingOptions: {
    recipe?: string
    lang?: string
  }
  requestId: string
  /** Opaque queue generation. Absent only on payloads created before token rollout. */
  processingQueueToken?: string
  /** Exact generation that enqueued this continuation before persisting its handoff. */
  processingPredecessorToken?: string
  /** Whether the actual predecessor invocation charged the admission being transferred. */
  processingPredecessorCharged?: boolean
  /** Whether this payload's admission incremented the durable attempt budget. */
  chargedAtDispatch?: boolean
  /** Exact queue-generation stamp this task is allowed to claim. */
  processingQueuedAt?: string
  /** Number of durable quota continuations already scheduled for this indexing pass. */
  quotaRetryCount?: number
  /** Number of durable provider-capacity continuations for this indexing pass. */
  providerRetryCount?: number
  /** Successful checkpointed slices that yielded before the worker deadline. */
  processingSliceCount?: number
  /** Start of the bounded provider-capacity recovery window. */
  providerRetryStartedAt?: string
}

export interface WorkspaceDocumentProcessingBillingContext {
  billingScope: 'workspace'
  actorUserId: string
  workspaceId: string
  billingAttribution: BillingAttributionSnapshot
}

export interface OrganizationDocumentProcessingBillingContext {
  billingScope: 'organization'
  actorUserId: string
  workspaceId: null
  organizationId: string
  billingAttribution: BillingAttributionSnapshot
}

export interface NonWorkspaceDocumentProcessingBillingContext {
  billingScope: 'non-workspace'
  actorUserId: string
  workspaceId: null
  billingAttribution?: never
}

export type DocumentProcessingBillingContext =
  | WorkspaceDocumentProcessingBillingContext
  | OrganizationDocumentProcessingBillingContext
  | NonWorkspaceDocumentProcessingBillingContext

export type DocumentProcessingPayload = DocumentProcessingPayloadBase &
  DocumentProcessingBillingContext

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function hasDocumentProcessingBillingScope(
  value: unknown
): value is { billingScope: unknown } {
  return isRecordLike(value) && 'billingScope' in value
}

export function assertDocumentProcessingBillingContext(
  value: unknown
): DocumentProcessingBillingContext {
  if (!isRecordLike(value)) {
    throw new Error('Document processing billing context must be an object')
  }
  if (!isNonEmptyString(value.actorUserId)) {
    throw new Error('Document processing actor is required')
  }

  if (value.billingScope === 'workspace') {
    if (!isNonEmptyString(value.workspaceId)) {
      throw new Error('Workspace document processing requires a workspace ID')
    }
    if (value.billingAttribution === undefined || value.billingAttribution === null) {
      throw new Error('Workspace document processing requires a billing attribution snapshot')
    }

    const billingAttribution = assertBillingAttributionSnapshot(value.billingAttribution)
    if (value.actorUserId !== billingAttribution.actorUserId) {
      throw new Error('Document processing actor does not match billing attribution')
    }
    if (value.workspaceId !== billingAttribution.workspaceId) {
      throw new Error('Document processing workspace does not match billing attribution')
    }

    return {
      billingScope: 'workspace',
      actorUserId: value.actorUserId,
      workspaceId: value.workspaceId,
      billingAttribution,
    }
  }

  if (value.billingScope === 'organization') {
    const attribution = assertBillingAttributionSnapshot(value.billingAttribution)
    if (
      !isNonEmptyString(value.organizationId) ||
      value.workspaceId !== null ||
      attribution.workspaceId !== null ||
      attribution.organizationId !== value.organizationId ||
      attribution.actorUserId !== value.actorUserId
    ) {
      throw new Error('Document processing organization does not match billing attribution')
    }
    return {
      billingScope: 'organization',
      workspaceId: null,
      organizationId: value.organizationId,
      actorUserId: value.actorUserId,
      billingAttribution: attribution,
    }
  }

  if (value.billingScope === 'non-workspace') {
    if (value.workspaceId !== null) {
      throw new Error('Non-workspace document processing must use a null workspace ID')
    }
    if (value.billingAttribution !== undefined) {
      throw new Error('Non-workspace document processing cannot include billing attribution')
    }
    return {
      billingScope: 'non-workspace',
      actorUserId: value.actorUserId,
      workspaceId: null,
    }
  }

  throw new Error('Document processing billing scope is invalid')
}

export function createWorkspaceDocumentProcessingBillingContext(
  value: unknown
): WorkspaceDocumentProcessingBillingContext {
  const billingAttribution = assertBillingAttributionSnapshot(value)
  if (!billingAttribution.workspaceId)
    throw new Error('Workspace processing requires workspace attribution')
  return {
    billingScope: 'workspace',
    actorUserId: billingAttribution.actorUserId,
    workspaceId: billingAttribution.workspaceId,
    billingAttribution,
  }
}

export function createNonWorkspaceDocumentProcessingBillingContext(
  actorUserId: string
): NonWorkspaceDocumentProcessingBillingContext {
  const billingContext = assertDocumentProcessingBillingContext({
    billingScope: 'non-workspace',
    actorUserId,
    workspaceId: null,
  })
  if (billingContext.billingScope !== 'non-workspace') {
    throw new Error('Non-workspace document processing context could not be created')
  }
  return billingContext
}

/** Identifies a durable handoff independently of its original indexing pass and scheduled time. */
export function createDocumentProcessingContinuationToken(
  payload: Pick<DocumentProcessingPayloadBase, 'documentId' | 'requestId'>,
  reason: 'quota' | 'provider' | 'slice',
  attempt: number
): string {
  return `knowledge-${reason}-${payload.documentId}-${payload.requestId}-${attempt}`
}

/** Whether adopting the original generation must refund its one dispatch admission. */
export function shouldRefundDocumentProcessingPredecessor(
  payload: DocumentProcessingPayload
): boolean {
  return payload.processingPredecessorCharged === true
}

export function assertDocumentProcessingPayload(value: unknown): DocumentProcessingPayload {
  if (!isRecordLike(value)) {
    throw new Error('Document processing payload must be an object')
  }
  if (
    !isNonEmptyString(value.knowledgeBaseId) ||
    !isNonEmptyString(value.documentId) ||
    !isNonEmptyString(value.requestId)
  ) {
    throw new Error('Document processing payload is missing an identifier')
  }
  if (
    value.processingQueueToken !== undefined &&
    (!isNonEmptyString(value.processingQueueToken) ||
      (value.processingQueueToken !== value.requestId &&
        !(
          typeof value.quotaRetryCount === 'number' &&
          value.quotaRetryCount > 0 &&
          value.processingQueueToken ===
            createDocumentProcessingContinuationToken(
              { documentId: value.documentId, requestId: value.requestId },
              'quota',
              value.quotaRetryCount
            )
        ) &&
        !(
          typeof value.processingSliceCount === 'number' &&
          value.processingSliceCount > 0 &&
          value.processingQueueToken ===
            createDocumentProcessingContinuationToken(
              { documentId: value.documentId, requestId: value.requestId },
              'slice',
              value.processingSliceCount
            )
        ) &&
        !(
          typeof value.providerRetryCount === 'number' &&
          value.providerRetryCount > 0 &&
          value.processingQueueToken ===
            createDocumentProcessingContinuationToken(
              { documentId: value.documentId, requestId: value.requestId },
              'provider',
              value.providerRetryCount
            )
        )))
  ) {
    throw new Error('Document processing queue token is invalid')
  }
  if (value.processingPredecessorToken !== undefined) {
    const counts = [
      ['quota', value.quotaRetryCount],
      ['provider', value.providerRetryCount],
      ['slice', value.processingSliceCount],
    ] as const
    const matchesPriorGeneration =
      value.processingPredecessorToken === value.requestId ||
      counts.some(
        ([reason, count]) =>
          typeof count === 'number' &&
          [count, count - 1].some(
            (attempt) =>
              attempt > 0 &&
              value.processingPredecessorToken ===
                createDocumentProcessingContinuationToken(
                  { documentId: value.documentId as string, requestId: value.requestId as string },
                  reason,
                  attempt
                )
          )
      )
    if (
      !isNonEmptyString(value.processingPredecessorToken) ||
      !isNonEmptyString(value.processingQueueToken) ||
      value.processingQueueToken === value.requestId ||
      value.processingPredecessorToken === value.processingQueueToken ||
      !matchesPriorGeneration
    ) {
      throw new Error('Document processing predecessor generation is invalid')
    }
  }
  if (
    value.processingPredecessorCharged !== undefined &&
    (typeof value.processingPredecessorCharged !== 'boolean' ||
      value.processingPredecessorToken === undefined)
  ) {
    throw new Error('Document processing predecessor admission marker is invalid')
  }
  if (value.processingQueueToken !== undefined && !isNonEmptyString(value.processingQueuedAt)) {
    throw new Error('Document processing payload is missing its queue stamp')
  }
  if (value.chargedAtDispatch !== undefined && typeof value.chargedAtDispatch !== 'boolean') {
    throw new Error('Document processing dispatch charge marker is invalid')
  }
  if (value.chargedAtDispatch !== undefined && value.processingQueueToken === undefined) {
    throw new Error('Document processing dispatch charge marker requires a queue token')
  }
  if (value.processingQueuedAt !== undefined) {
    if (!isNonEmptyString(value.processingQueuedAt)) {
      throw new Error('Document processing queue stamp is invalid')
    }
    const processingQueuedAt = new Date(value.processingQueuedAt)
    if (
      Number.isNaN(processingQueuedAt.getTime()) ||
      processingQueuedAt.toISOString() !== value.processingQueuedAt
    ) {
      throw new Error('Document processing queue stamp is invalid')
    }
  }
  if (!isRecordLike(value.docData)) {
    throw new Error('Document processing payload is missing document data')
  }
  const docData = value.docData
  if (
    typeof docData.filename !== 'string' ||
    typeof docData.fileUrl !== 'string' ||
    typeof docData.mimeType !== 'string' ||
    typeof docData.fileSize !== 'number' ||
    !Number.isFinite(docData.fileSize) ||
    docData.fileSize < 0
  ) {
    throw new Error('Document processing payload has invalid document data')
  }
  if (!isRecordLike(value.processingOptions)) {
    throw new Error('Document processing payload is missing processing options')
  }
  if (
    value.quotaRetryCount !== undefined &&
    (typeof value.quotaRetryCount !== 'number' ||
      !Number.isSafeInteger(value.quotaRetryCount) ||
      value.quotaRetryCount < 0)
  ) {
    throw new Error('Document processing quota retry count is invalid')
  }
  const processingOptions = value.processingOptions
  if (
    value.providerRetryCount !== undefined &&
    (typeof value.providerRetryCount !== 'number' ||
      !Number.isSafeInteger(value.providerRetryCount) ||
      value.providerRetryCount < 1)
  ) {
    throw new Error('Document processing provider retry count is invalid')
  }
  if (
    value.processingSliceCount !== undefined &&
    (typeof value.processingSliceCount !== 'number' ||
      !Number.isSafeInteger(value.processingSliceCount) ||
      value.processingSliceCount < 1)
  ) {
    throw new Error('Document processing slice count is invalid')
  }
  if (
    (value.providerRetryCount === undefined && value.processingSliceCount === undefined) !==
    (value.providerRetryStartedAt === undefined)
  ) {
    throw new Error(
      'Document processing continuation count and start time must be supplied together'
    )
  }
  if (value.providerRetryStartedAt !== undefined) {
    if (
      !isNonEmptyString(value.providerRetryStartedAt) ||
      Number.isNaN(Date.parse(value.providerRetryStartedAt)) ||
      new Date(value.providerRetryStartedAt).toISOString() !== value.providerRetryStartedAt
    ) {
      throw new Error('Document processing provider retry start time is invalid')
    }
  }
  if (
    (processingOptions.recipe !== undefined && typeof processingOptions.recipe !== 'string') ||
    (processingOptions.lang !== undefined && typeof processingOptions.lang !== 'string')
  ) {
    throw new Error('Document processing payload has invalid processing options')
  }

  const billingContext = assertDocumentProcessingBillingContext(value)
  return {
    knowledgeBaseId: value.knowledgeBaseId,
    documentId: value.documentId,
    docData: {
      filename: docData.filename,
      fileUrl: docData.fileUrl,
      fileSize: docData.fileSize,
      mimeType: docData.mimeType,
    },
    processingOptions: {
      ...(processingOptions.recipe !== undefined ? { recipe: processingOptions.recipe } : {}),
      ...(processingOptions.lang !== undefined ? { lang: processingOptions.lang } : {}),
    },
    requestId: value.requestId,
    ...(value.processingQueueToken !== undefined
      ? { processingQueueToken: value.processingQueueToken }
      : {}),
    ...(value.processingPredecessorToken !== undefined
      ? { processingPredecessorToken: value.processingPredecessorToken }
      : {}),
    ...(value.processingPredecessorCharged !== undefined
      ? { processingPredecessorCharged: value.processingPredecessorCharged }
      : {}),
    ...(value.chargedAtDispatch !== undefined
      ? { chargedAtDispatch: value.chargedAtDispatch }
      : {}),
    ...(value.processingQueuedAt !== undefined
      ? { processingQueuedAt: value.processingQueuedAt }
      : {}),
    ...(value.quotaRetryCount !== undefined ? { quotaRetryCount: value.quotaRetryCount } : {}),
    ...(value.providerRetryCount !== undefined
      ? { providerRetryCount: value.providerRetryCount }
      : {}),
    ...(value.processingSliceCount !== undefined
      ? { processingSliceCount: value.processingSliceCount }
      : {}),
    ...(value.providerRetryStartedAt !== undefined
      ? { providerRetryStartedAt: value.providerRetryStartedAt }
      : {}),
    ...billingContext,
  }
}

export function createDocumentProcessingPayload(
  payload: DocumentProcessingPayloadBase,
  billingContext: DocumentProcessingBillingContext
): DocumentProcessingPayload {
  return assertDocumentProcessingPayload({ ...payload, ...billingContext })
}

export function createOrganizationDocumentProcessingBillingContext(
  value: unknown
): OrganizationDocumentProcessingBillingContext {
  const attribution = assertBillingAttributionSnapshot(value)
  const context = assertDocumentProcessingBillingContext({
    billingScope: 'organization',
    workspaceId: null,
    organizationId: attribution.organizationId,
    actorUserId: attribution.actorUserId,
    billingAttribution: attribution,
  })
  if (context.billingScope !== 'organization')
    throw new Error('Expected organization billing scope')
  return context
}
