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
}

export interface WorkspaceDocumentProcessingBillingContext {
  billingScope: 'workspace'
  actorUserId: string
  workspaceId: string
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
    ...billingContext,
  }
}

export function createDocumentProcessingPayload(
  payload: DocumentProcessingPayloadBase,
  billingContext: DocumentProcessingBillingContext
): DocumentProcessingPayload {
  return assertDocumentProcessingPayload({ ...payload, ...billingContext })
}
