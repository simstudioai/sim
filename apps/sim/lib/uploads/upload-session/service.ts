import { generateId } from '@sim/utils/id'
import {
  checkStorageQuotaForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateExecutionFileKey } from '@/lib/uploads/contexts/execution/utils'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace'
import {
  signUploadToken,
  type UploadSessionPurpose,
  type UploadStorageProvider,
  type UploadTokenPayload,
  type UploadTransferMethod,
  verifyUploadToken,
} from '@/lib/uploads/core/upload-token'
import {
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
  MAX_WORKSPACE_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
  type StorageContext,
} from '@/lib/uploads/shared/types'
import { maybeCleanupLocalUploadArtifacts } from '@/lib/uploads/upload-session/cleanup'
import {
  abortProviderUpload,
  type CompletedUploadPart,
  completeMultipartProviderUpload,
  createPutProviderTransfer,
  deleteProviderObjectVersion,
  getMultipartProviderPartUrls,
  headProviderObject,
  initiateMultipartProviderUpload,
  promoteProviderObject,
  type UploadPartUrl,
  uploadStorageProvider,
} from '@/lib/uploads/upload-session/provider'
import { sanitizeFileName } from '@/executor/constants'

export const UPLOAD_SESSION_PUT_MAX_BYTES = 50 * 1024 * 1024
export const UPLOAD_SESSION_PART_SIZE = 8 * 1024 * 1024
export const UPLOAD_SESSION_MAX_PART_URLS = 100
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const UPLOAD_SESSION_ASSET_MAX_BYTES = 5 * 1024 * 1024

export type { UploadSessionPurpose, UploadTransferMethod }

export type UploadSessionStatus = 'uploading' | 'completed' | 'aborted'

export type UploadSessionTransfer =
  | { method: 'put'; url: string; headers: Record<string, string> }
  | { method: 'multipart'; partSize: number; partCount: number }

export interface UploadSessionRecord {
  id: string
  workspaceId: string | null
  userId: string
  knowledgeBaseId: string | null
  workflowId: string | null
  executionId: string | null
  purpose: UploadSessionPurpose
  method: UploadTransferMethod
  storageContext: StorageContext
  /** Canonical destination key retained for existing domain finalizers. */
  storageKey: string
  finalKey: string
  stagingKey: string
  storageProvider: UploadStorageProvider
  providerUploadId: string | null
  fileName: string
  contentType: string
  fileSize: number
  partSize: number | null
  partCount: number | null
  status: UploadSessionStatus
  metadata: Record<string, unknown>
  uploadToken: string
  createdAt: Date
  expiresAt: Date
  completedFileId: string | null
  error: string | null
  completedAt: Date | null
  updatedAt: Date
}

export interface CreatedUploadSession extends UploadSessionRecord {
  transfer: UploadSessionTransfer
}

export type UploadCompletion = { parts?: never } | { parts: CompletedUploadPart[] }

export class UploadSessionError extends OrchestrationError {
  constructor(
    code: 'validation' | 'not_found' | 'forbidden' | 'conflict' | 'payload_too_large' | 'internal',
    message: string
  ) {
    super(code, message)
    this.name = 'UploadSessionError'
  }
}

interface CreateUploadSessionBaseParams {
  id?: string
  userId: string
  fileName: string
  contentType: string
  fileSize: number
  metadata?: Record<string, unknown>
  localOrigin?: string
}

export type CreateUploadSessionParams = CreateUploadSessionBaseParams &
  (
    | { purpose: 'workspace_file' | 'table_import'; workspaceId: string }
    | { purpose: 'knowledge_document'; workspaceId: string; knowledgeBaseId: string }
    | { purpose: 'profile_picture'; workspaceId?: null }
    | { purpose: 'workspace_logo' | 'mothership_attachment'; workspaceId: string }
    | {
        purpose: 'execution_attachment'
        workspaceId: string
        workflowId: string
        executionId: string
      }
  )

export async function createUploadSession(
  params: CreateUploadSessionParams
): Promise<CreatedUploadSession> {
  validateFile(params)
  const id = params.id ?? generateId()
  const workspaceId = params.purpose === 'profile_picture' ? null : params.workspaceId
  const { storageContext, finalKey } = resolveUploadStorage(params, id)
  const stagingKey = `upload-sessions/${id}/${sanitizeFileName(params.fileName)}`
  const method: UploadTransferMethod =
    params.fileSize <= UPLOAD_SESSION_PUT_MAX_BYTES ? 'put' : 'multipart'
  const partSize = method === 'multipart' ? UPLOAD_SESSION_PART_SIZE : null
  const partCount =
    method === 'multipart' ? Math.ceil(params.fileSize / UPLOAD_SESSION_PART_SIZE) : null

  if (requiresStorageQuota(params.purpose)) {
    if (!workspaceId) throw new Error(`${params.purpose} upload is missing workspaceId`)
    const billingContext = await resolveStorageBillingContext(workspaceId)
    const quota = await checkStorageQuotaForBillingContext(billingContext, params.fileSize)
    if (!quota.allowed) {
      throw new UploadSessionError('payload_too_large', quota.error ?? 'Storage limit exceeded')
    }
  }

  const provider = uploadStorageProvider()
  if (provider === 'local') await maybeCleanupLocalUploadArtifacts()
  const objectMetadata = uploadSessionObjectMetadata({
    id,
    userId: params.userId,
    workspaceId,
    purpose: params.purpose,
    fileName: params.fileName,
    knowledgeBaseId: params.purpose === 'knowledge_document' ? params.knowledgeBaseId : null,
    workflowId: params.purpose === 'execution_attachment' ? params.workflowId : null,
    executionId: params.purpose === 'execution_attachment' ? params.executionId : null,
  })
  const initiated =
    method === 'multipart'
      ? await initiateMultipartProviderUpload({
          stagingKey,
          fileName: params.fileName,
          contentType: params.contentType,
          fileSize: params.fileSize,
          context: storageContext,
          uploadId: id,
          metadata: objectMetadata,
        })
      : { provider, providerUploadId: null }
  if (initiated.provider !== provider) {
    throw new Error('Storage provider changed while creating upload session')
  }

  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + UPLOAD_SESSION_TTL_MS)
  const metadata = params.metadata ?? {}
  const tokenPayload = createUploadTokenPayload({
    params,
    id,
    workspaceId,
    storageContext,
    finalKey,
    stagingKey,
    provider,
    providerUploadId: initiated.providerUploadId,
    method,
    partSize,
    partCount,
    metadata,
    createdAt,
    expiresAt,
  })
  const uploadToken = signUploadToken(tokenPayload)
  const transfer: UploadSessionTransfer =
    method === 'put'
      ? await createPutProviderTransfer({
          provider,
          stagingKey,
          contentType: params.contentType,
          fileSize: params.fileSize,
          context: storageContext,
          uploadId: id,
          uploadToken,
          localOrigin: params.localOrigin,
          expiresAt,
          metadata: objectMetadata,
        })
      : { method, partSize: requireNumber(partSize), partCount: requireNumber(partCount) }

  return sessionFromPayload(tokenPayload, uploadToken, transfer)
}

export function getOwnedUploadSession(params: {
  uploadId: string
  uploadToken: string
  userId?: string
  workspaceId?: string | null
  purpose?: UploadSessionPurpose
  knowledgeBaseId?: string
  workflowId?: string
  executionId?: string
}): UploadSessionRecord {
  const session = verifyUploadSessionToken(params.uploadToken)
  if (session.id !== params.uploadId) throw uploadNotFound()
  if (params.userId !== undefined && session.userId !== params.userId) throw uploadNotFound()
  if (params.workspaceId !== undefined && session.workspaceId !== params.workspaceId) {
    throw uploadNotFound()
  }
  if (params.purpose !== undefined && session.purpose !== params.purpose) throw uploadNotFound()
  if (params.knowledgeBaseId !== undefined && session.knowledgeBaseId !== params.knowledgeBaseId) {
    throw uploadNotFound()
  }
  if (params.workflowId !== undefined && session.workflowId !== params.workflowId) {
    throw uploadNotFound()
  }
  if (params.executionId !== undefined && session.executionId !== params.executionId) {
    throw uploadNotFound()
  }
  return session
}

export function verifyUploadSessionToken(uploadToken: string): UploadSessionRecord {
  const verified = verifyUploadToken(uploadToken)
  if (!verified.valid) throw new UploadSessionError('forbidden', 'Invalid or expired upload token')
  return sessionFromPayload(verified.payload, uploadToken)
}

export async function createUploadPartUrls(params: {
  session: UploadSessionRecord
  partNumbers: number[]
  localOrigin: string
}): Promise<UploadPartUrl[]> {
  assertUploadable(params.session)
  if (params.session.method !== 'multipart' || !params.session.partCount) {
    throw new UploadSessionError('conflict', 'PUT upload sessions do not have multipart parts')
  }
  const unique = new Set(params.partNumbers)
  if (unique.size !== params.partNumbers.length) {
    throw new UploadSessionError('validation', 'partNumbers must not contain duplicates')
  }
  if (params.partNumbers.length === 0 || params.partNumbers.length > UPLOAD_SESSION_MAX_PART_URLS) {
    throw new UploadSessionError(
      'validation',
      `partNumbers must contain between 1 and ${UPLOAD_SESSION_MAX_PART_URLS} entries`
    )
  }
  for (const partNumber of params.partNumbers) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > params.session.partCount) {
      throw new UploadSessionError(
        'validation',
        `partNumber must be between 1 and ${params.session.partCount}`
      )
    }
  }

  return getMultipartProviderPartUrls({
    provider: params.session.storageProvider,
    providerUploadId: params.session.providerUploadId,
    stagingKey: params.session.stagingKey,
    context: params.session.storageContext,
    partNumbers: params.partNumbers,
    localUrl: (partNumber) =>
      `${params.localOrigin}/api/v2/uploads/${params.session.id}/parts/${partNumber}?token=${encodeURIComponent(params.session.uploadToken)}`,
  })
}

export async function completeUploadSession<T>(params: {
  session: UploadSessionRecord
  completion: UploadCompletion
  finalize: (session: UploadSessionRecord) => Promise<{ value: T; completedFileId?: string }>
}): Promise<{ session: UploadSessionRecord; value: T; alreadyCompleted: boolean }> {
  assertUploadable(params.session)
  const parts = validateUploadCompletion(params.session, params.completion)
  let existingFinal = await headProviderObject({
    provider: params.session.storageProvider,
    key: params.session.finalKey,
    context: params.session.storageContext,
  })
  const alreadyCompleted = existingFinal !== null
  if (existingFinal) assertObjectIdentity(params.session, existingFinal, 'Final')

  if (!existingFinal) {
    let staging = await headProviderObject({
      provider: params.session.storageProvider,
      key: params.session.stagingKey,
      context: params.session.storageContext,
    })
    if (staging) assertObjectIdentity(params.session, staging, 'Uploaded')

    if (!staging && params.session.method === 'multipart') {
      try {
        await completeMultipartProviderUpload({
          provider: params.session.storageProvider,
          providerUploadId: params.session.providerUploadId,
          uploadId: params.session.id,
          stagingKey: params.session.stagingKey,
          contentType: params.session.contentType,
          context: params.session.storageContext,
          parts,
          metadata: uploadSessionObjectMetadata(params.session),
        })
      } catch (completionError) {
        staging = await headProviderObject({
          provider: params.session.storageProvider,
          key: params.session.stagingKey,
          context: params.session.storageContext,
        })
        if (!staging) throw completionError
        assertObjectIdentity(params.session, staging, 'Uploaded')
      }
    }

    if (!staging) {
      staging = await headProviderObject({
        provider: params.session.storageProvider,
        key: params.session.stagingKey,
        context: params.session.storageContext,
      })
    }

    if (!staging) throw new UploadSessionError('conflict', 'Uploaded staging object not found')
    assertObjectIdentity(params.session, staging, 'Uploaded')

    try {
      await promoteProviderObject({
        provider: params.session.storageProvider,
        sourceKey: params.session.stagingKey,
        destinationKey: params.session.finalKey,
        sourceVersion: staging.version,
        context: params.session.storageContext,
      })
    } catch (error) {
      existingFinal = await headProviderObject({
        provider: params.session.storageProvider,
        key: params.session.finalKey,
        context: params.session.storageContext,
      })
      if (!existingFinal) throw error
      assertObjectIdentity(params.session, existingFinal, 'Final')
    }

    const promoted = await headProviderObject({
      provider: params.session.storageProvider,
      key: params.session.finalKey,
      context: params.session.storageContext,
    })
    if (!promoted) throw new Error('Promoted upload object not found')
    assertObjectIdentity(params.session, promoted, 'Promoted')
  }

  const finalized = await params.finalize(params.session)
  await cleanupStagingObject(params.session)
  const completedAt = new Date()
  return {
    session: {
      ...params.session,
      status: 'completed',
      completedFileId: finalized.completedFileId ?? null,
      completedAt,
      updatedAt: completedAt,
    },
    value: finalized.value,
    alreadyCompleted,
  }
}

export async function abortUploadSession(
  session: UploadSessionRecord
): Promise<UploadSessionRecord> {
  assertUploadable(session)
  await abortProviderUpload({
    provider: session.storageProvider,
    method: session.method,
    providerUploadId: session.providerUploadId,
    uploadId: session.id,
    stagingKey: session.stagingKey,
    context: session.storageContext,
  })
  const completedAt = new Date()
  return { ...session, status: 'aborted', completedAt, updatedAt: completedAt }
}

export function expectedUploadPartSize(session: UploadSessionRecord, partNumber: number): number {
  if (session.method !== 'multipart' || !session.partSize || !session.partCount) {
    throw new UploadSessionError('conflict', 'PUT upload sessions do not have multipart parts')
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.partCount) {
    throw new UploadSessionError('validation', 'Invalid upload part number')
  }
  if (partNumber < session.partCount) return session.partSize
  return session.fileSize - session.partSize * (session.partCount - 1)
}

export function uploadSessionObjectMetadata(
  session: Pick<
    UploadSessionRecord,
    | 'id'
    | 'userId'
    | 'workspaceId'
    | 'purpose'
    | 'fileName'
    | 'knowledgeBaseId'
    | 'workflowId'
    | 'executionId'
  >
): Record<string, string> {
  return {
    uploadId: session.id,
    userId: session.userId,
    originalName: session.fileName,
    purpose: session.purpose,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.knowledgeBaseId ? { knowledgeBaseId: session.knowledgeBaseId } : {}),
    ...(session.workflowId ? { workflowId: session.workflowId } : {}),
    ...(session.executionId ? { executionId: session.executionId } : {}),
  }
}

function sessionFromPayload(
  payload: UploadTokenPayload,
  uploadToken: string,
  transfer: UploadSessionTransfer
): CreatedUploadSession
function sessionFromPayload(
  payload: UploadTokenPayload,
  uploadToken: string,
  transfer?: undefined
): UploadSessionRecord
function sessionFromPayload(
  payload: UploadTokenPayload,
  uploadToken: string,
  transfer?: UploadSessionTransfer
): CreatedUploadSession | UploadSessionRecord {
  const createdAt = new Date(payload.createdAt)
  const expiresAt = new Date(payload.expiresAt)
  const session: UploadSessionRecord = {
    id: payload.uploadId,
    workspaceId: payload.workspaceId,
    userId: payload.actorId,
    knowledgeBaseId: payload.purpose === 'knowledge_document' ? payload.knowledgeBaseId : null,
    workflowId: payload.purpose === 'execution_attachment' ? payload.workflowId : null,
    executionId: payload.purpose === 'execution_attachment' ? payload.executionId : null,
    purpose: payload.purpose,
    method: payload.method,
    storageContext: payload.context,
    storageKey: payload.finalKey,
    finalKey: payload.finalKey,
    stagingKey: payload.stagingKey,
    storageProvider: payload.provider,
    providerUploadId: payload.providerUploadId,
    fileName: payload.fileName,
    contentType: payload.contentType,
    fileSize: payload.fileSize,
    partSize: payload.method === 'multipart' ? payload.partSize : null,
    partCount: payload.method === 'multipart' ? payload.partCount : null,
    status: 'uploading',
    metadata: payload.metadata,
    uploadToken,
    createdAt,
    expiresAt,
    completedFileId: null,
    error: null,
    completedAt: null,
    updatedAt: new Date(),
  }
  return transfer ? { ...session, transfer } : session
}

function createUploadTokenPayload(params: {
  params: CreateUploadSessionParams
  id: string
  workspaceId: string | null
  storageContext: StorageContext
  finalKey: string
  stagingKey: string
  provider: UploadStorageProvider
  providerUploadId: string | null
  method: UploadTransferMethod
  partSize: number | null
  partCount: number | null
  metadata: Record<string, unknown>
  createdAt: Date
  expiresAt: Date
}): UploadTokenPayload {
  const base = {
    uploadId: params.id,
    actorId: params.params.userId,
    finalKey: params.finalKey,
    stagingKey: params.stagingKey,
    provider: params.provider,
    fileName: params.params.fileName,
    contentType: params.params.contentType,
    fileSize: params.params.fileSize,
    metadata: params.metadata,
    createdAt: params.createdAt.toISOString(),
    expiresAt: params.expiresAt.toISOString(),
  }
  const transfer =
    params.method === 'put'
      ? ({ method: 'put', providerUploadId: null } as const)
      : ({
          method: 'multipart',
          providerUploadId: params.providerUploadId,
          partSize: requireNumber(params.partSize),
          partCount: requireNumber(params.partCount),
        } as const)

  switch (params.params.purpose) {
    case 'workspace_file':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: params.params.workspaceId,
        context: 'workspace',
      }
    case 'table_import':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: params.params.workspaceId,
        context: 'table-import',
      }
    case 'knowledge_document':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: params.params.workspaceId,
        context: 'knowledge-base',
        knowledgeBaseId: params.params.knowledgeBaseId,
      }
    case 'profile_picture':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: null,
        context: 'profile-pictures',
      }
    case 'workspace_logo':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: params.params.workspaceId,
        context: 'workspace-logos',
      }
    case 'mothership_attachment':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: params.params.workspaceId,
        context: 'mothership',
      }
    case 'execution_attachment':
      return {
        ...base,
        ...transfer,
        purpose: params.params.purpose,
        workspaceId: params.params.workspaceId,
        context: 'execution',
        workflowId: params.params.workflowId,
        executionId: params.params.executionId,
      }
  }
}

function assertUploadable(session: UploadSessionRecord): void {
  if (session.status !== 'uploading') {
    throw new UploadSessionError('conflict', `Upload session is ${session.status}`)
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UploadSessionError('conflict', 'Upload session has expired')
  }
}

/**
 * Validates method-specific completion input before any idempotent replay shortcut is taken.
 * Callers that can return an already-completed resource must run this first as well.
 */
export function validateUploadCompletion(
  session: UploadSessionRecord,
  completion: UploadCompletion
): CompletedUploadPart[] {
  if (session.method === 'put') {
    if ('parts' in completion) {
      throw new UploadSessionError('validation', 'PUT completion must not include parts')
    }
    return []
  }
  if (!('parts' in completion) || !completion.parts) {
    throw new UploadSessionError('validation', 'Multipart completion requires parts')
  }
  validateCompletedParts(session, completion.parts)
  return completion.parts
}

function validateCompletedParts(session: UploadSessionRecord, parts: CompletedUploadPart[]): void {
  if (!session.partCount) throw new Error('Multipart upload is missing partCount')
  if (parts.length !== session.partCount) {
    throw new UploadSessionError(
      'validation',
      `Expected ${session.partCount} completed parts; received ${parts.length}`
    )
  }
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  for (let index = 0; index < sorted.length; index++) {
    if (sorted[index].partNumber !== index + 1) {
      throw new UploadSessionError(
        'validation',
        'Completed parts must contain every part exactly once'
      )
    }
    if (
      (session.storageProvider === 's3' || session.storageProvider === 'gcs') &&
      !sorted[index].etag
    ) {
      throw new UploadSessionError(
        'validation',
        `etag is required for ${session.storageProvider} part ${sorted[index].partNumber}`
      )
    }
  }
}

function assertObjectIdentity(
  session: UploadSessionRecord,
  object: { size: number; contentType: string; uploadId: string },
  label: string
): void {
  if (object.uploadId !== session.id) {
    throw new UploadSessionError('conflict', `${label} object belongs to another upload`)
  }
  if (object.size !== session.fileSize) {
    throw new UploadSessionError(
      'conflict',
      `${label} object has ${object.size} bytes; expected ${session.fileSize}`
    )
  }
  if (object.contentType !== session.contentType) {
    throw new UploadSessionError(
      'conflict',
      `${label} object has content type ${object.contentType}; expected ${session.contentType}`
    )
  }
}

async function cleanupStagingObject(session: UploadSessionRecord): Promise<void> {
  const staging = await headProviderObject({
    provider: session.storageProvider,
    key: session.stagingKey,
    context: session.storageContext,
  })
  if (!staging) return
  assertObjectIdentity(session, staging, 'Staging')
  await deleteProviderObjectVersion({
    provider: session.storageProvider,
    key: session.stagingKey,
    version: staging.version,
    context: session.storageContext,
  })
}

function validateFile(params: CreateUploadSessionParams): void {
  if (!params.fileName.trim()) {
    throw new UploadSessionError('validation', 'fileName must not be empty')
  }
  if (!params.contentType.trim()) {
    throw new UploadSessionError('validation', 'contentType must not be empty')
  }
  const minimum = params.purpose === 'workspace_file' ? 0 : 1
  if (!Number.isSafeInteger(params.fileSize) || params.fileSize < minimum) {
    const range = minimum === 0 ? 'a non-negative integer' : 'a positive integer'
    throw new UploadSessionError('validation', `fileSize must be ${range}`)
  }
  const maximum = maximumFileSize(params.purpose)
  if (params.fileSize > maximum) {
    throw new UploadSessionError('validation', `File size exceeds maximum of ${maximum} bytes`)
  }
  if (params.purpose !== 'profile_picture' && !params.workspaceId.trim()) {
    throw new UploadSessionError('validation', 'workspaceId must not be empty')
  }
  if (params.purpose === 'knowledge_document' && !params.knowledgeBaseId.trim()) {
    throw new UploadSessionError('validation', 'knowledgeBaseId must not be empty')
  }
  if (
    params.purpose === 'execution_attachment' &&
    (!params.workflowId.trim() || !params.executionId.trim())
  ) {
    throw new UploadSessionError('validation', 'workflowId and executionId must not be empty')
  }
}

function maximumFileSize(purpose: UploadSessionPurpose): number {
  if (purpose === 'knowledge_document') return MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE
  if (purpose === 'profile_picture' || purpose === 'workspace_logo') {
    return UPLOAD_SESSION_ASSET_MAX_BYTES
  }
  if (purpose === 'execution_attachment') {
    return MAX_WORKSPACE_FORMDATA_FILE_SIZE
  }
  return MAX_WORKSPACE_FILE_SIZE
}

function requiresStorageQuota(purpose: UploadSessionPurpose): boolean {
  return purpose === 'workspace_file' || purpose === 'knowledge_document'
}

function resolveUploadStorage(
  params: CreateUploadSessionParams,
  id: string
): { storageContext: StorageContext; finalKey: string } {
  switch (params.purpose) {
    case 'workspace_file':
      return {
        storageContext: 'workspace',
        finalKey: generateWorkspaceFileKey(params.workspaceId, params.fileName),
      }
    case 'table_import':
      return {
        storageContext: 'table-import',
        finalKey: `table-import/${params.workspaceId}/${id}/${sanitizeFileName(params.fileName)}`,
      }
    case 'knowledge_document':
      return {
        storageContext: 'knowledge-base',
        finalKey: generateKnowledgeBaseFileKey(params.fileName),
      }
    case 'profile_picture':
      return {
        storageContext: 'profile-pictures',
        finalKey: `profile-pictures/${id}-${sanitizeFileName(params.fileName)}`,
      }
    case 'workspace_logo':
      return {
        storageContext: 'workspace-logos',
        finalKey: `workspace-logos/${params.workspaceId}/${id}-${sanitizeFileName(params.fileName)}`,
      }
    case 'mothership_attachment':
      return {
        storageContext: 'mothership',
        finalKey: generateWorkspaceFileKey(params.workspaceId, params.fileName),
      }
    case 'execution_attachment':
      return {
        storageContext: 'execution',
        finalKey: generateExecutionFileKey(
          {
            workspaceId: params.workspaceId,
            workflowId: params.workflowId,
            executionId: params.executionId,
          },
          `${id}-${params.fileName}`
        ),
      }
  }
}

function uploadNotFound(): UploadSessionError {
  return new UploadSessionError('not_found', 'Upload session not found')
}

function requireNumber(value: number | null): number {
  if (value === null) throw new Error('Multipart upload geometry is missing')
  return value
}
