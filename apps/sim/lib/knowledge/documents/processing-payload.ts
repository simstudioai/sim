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
  /** Whether this payload's admission incremented the durable attempt budget. */
  chargedAtDispatch?: boolean
  /** Exact queue-generation stamp this task is allowed to claim. */
  processingQueuedAt?: string
  /** Number of durable quota continuations already scheduled for this indexing pass. */
  quotaRetryCount?: number
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
      value.processingQueueToken !== value.requestId)
  ) {
    throw new Error('Document processing queue token is invalid')
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
    ...(value.chargedAtDispatch !== undefined
      ? { chargedAtDispatch: value.chargedAtDispatch }
      : {}),
    ...(value.processingQueuedAt !== undefined
      ? { processingQueuedAt: value.processingQueuedAt }
      : {}),
    ...(value.quotaRetryCount !== undefined ? { quotaRetryCount: value.quotaRetryCount } : {}),
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
