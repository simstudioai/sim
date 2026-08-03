import { generateId } from '@sim/utils/id'
import {
  checkStorageQuotaForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace'
import { headObject } from '@/lib/uploads/core/storage-service'
import { signUploadToken, verifyUploadToken } from '@/lib/uploads/core/upload-token'
import {
  abortMultipartProviderUpload,
  type CompletedUploadPart,
  completeMultipartProviderUpload,
  getMultipartProviderPartUrls,
  initiateMultipartProviderUpload,
  type MultipartPartUrl,
  type MultipartStorageProvider,
} from '@/lib/uploads/multipart-session/provider'
import { MAX_WORKSPACE_FILE_SIZE, type StorageContext } from '@/lib/uploads/shared/types'
import { sanitizeFileName } from '@/executor/constants'

export const MULTIPART_SESSION_PART_SIZE = 8 * 1024 * 1024
export const MULTIPART_SESSION_MAX_PART_URLS = 100
export const MULTIPART_SESSION_TTL_MS = 24 * 60 * 60 * 1000

export type UploadSessionPurpose = 'workspace_file' | 'table_import'
export type UploadSessionStatus = 'uploading' | 'completed' | 'aborted'

export interface UploadSessionRecord {
  id: string
  workspaceId: string
  userId: string
  purpose: UploadSessionPurpose
  storageContext: StorageContext
  storageKey: string
  storageProvider: MultipartStorageProvider
  providerUploadId: string | null
  fileName: string
  contentType: string
  fileSize: number
  partSize: number
  partCount: number
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

export class UploadSessionError extends OrchestrationError {
  constructor(
    code: 'validation' | 'not_found' | 'forbidden' | 'conflict' | 'payload_too_large' | 'internal',
    message: string
  ) {
    super(code, message)
    this.name = 'UploadSessionError'
  }
}

interface CreateUploadSessionParams {
  id?: string
  workspaceId: string
  userId: string
  purpose: UploadSessionPurpose
  fileName: string
  contentType: string
  fileSize: number
  metadata?: Record<string, unknown>
}

export async function createUploadSession(
  params: CreateUploadSessionParams
): Promise<UploadSessionRecord> {
  validateFileSize(params.fileSize)
  const id = params.id ?? generateId()
  const storageContext: StorageContext =
    params.purpose === 'workspace_file' ? 'workspace' : 'table-import'
  const storageKey =
    params.purpose === 'workspace_file'
      ? generateWorkspaceFileKey(params.workspaceId, params.fileName)
      : `table-import/${params.workspaceId}/${id}/${sanitizeFileName(params.fileName)}`
  const partCount = Math.ceil(params.fileSize / MULTIPART_SESSION_PART_SIZE)

  if (params.purpose === 'workspace_file') {
    const billingContext = await resolveStorageBillingContext(params.workspaceId)
    const quota = await checkStorageQuotaForBillingContext(billingContext, params.fileSize)
    if (!quota.allowed) {
      throw new UploadSessionError('payload_too_large', quota.error ?? 'Storage limit exceeded')
    }
  }

  const initiated = await initiateMultipartProviderUpload({
    key: storageKey,
    fileName: params.fileName,
    contentType: params.contentType,
    fileSize: params.fileSize,
    context: storageContext,
    localUploadId: id,
  })
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + MULTIPART_SESSION_TTL_MS)
  const metadata = params.metadata ?? {}
  const uploadToken = signUploadToken(
    {
      uploadId: id,
      key: storageKey,
      userId: params.userId,
      workspaceId: params.workspaceId,
      context: storageContext,
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
      purpose: params.purpose,
      provider: initiated.provider,
      providerUploadId: initiated.providerUploadId,
      partSize: MULTIPART_SESSION_PART_SIZE,
      partCount,
      metadata,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    MULTIPART_SESSION_TTL_MS / 1000
  )

  return {
    id,
    workspaceId: params.workspaceId,
    userId: params.userId,
    purpose: params.purpose,
    storageContext,
    storageKey,
    storageProvider: initiated.provider,
    providerUploadId: initiated.providerUploadId,
    fileName: params.fileName,
    contentType: params.contentType,
    fileSize: params.fileSize,
    partSize: MULTIPART_SESSION_PART_SIZE,
    partCount,
    status: 'uploading',
    metadata,
    uploadToken,
    createdAt,
    expiresAt,
    completedFileId: null,
    error: null,
    completedAt: null,
    updatedAt: createdAt,
  }
}

export function getOwnedUploadSession(params: {
  uploadId: string
  workspaceId: string
  userId?: string
  uploadToken: string
}): UploadSessionRecord {
  const session = verifyUploadSessionToken(params.uploadToken)
  if (session.id !== params.uploadId || session.workspaceId !== params.workspaceId) {
    throw new UploadSessionError('not_found', 'Upload session not found')
  }
  if (params.userId && session.userId !== params.userId) {
    throw new UploadSessionError('not_found', 'Upload session not found')
  }
  return session
}

export function verifyUploadSessionToken(uploadToken: string): UploadSessionRecord {
  const verified = verifyUploadToken(uploadToken)
  if (!verified.valid) throw new UploadSessionError('forbidden', 'Invalid or expired upload token')
  const payload = verified.payload
  if (
    !payload.fileName ||
    !payload.contentType ||
    typeof payload.fileSize !== 'number' ||
    !Number.isSafeInteger(payload.fileSize) ||
    !payload.purpose ||
    !payload.provider ||
    typeof payload.partSize !== 'number' ||
    !Number.isSafeInteger(payload.partSize) ||
    typeof payload.partCount !== 'number' ||
    !Number.isSafeInteger(payload.partCount) ||
    !payload.createdAt ||
    !payload.expiresAt
  ) {
    throw new UploadSessionError('forbidden', 'Upload token is not a multipart session token')
  }
  if (payload.context !== 'workspace' && payload.context !== 'table-import') {
    throw new UploadSessionError('forbidden', 'Upload token has an invalid storage context')
  }
  const createdAt = new Date(payload.createdAt)
  const expiresAt = new Date(payload.expiresAt)
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    throw new UploadSessionError('forbidden', 'Upload token has invalid timestamps')
  }
  const now = new Date()
  return {
    id: payload.uploadId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    purpose: payload.purpose,
    storageContext: payload.context,
    storageKey: payload.key,
    storageProvider: payload.provider,
    providerUploadId: payload.providerUploadId ?? null,
    fileName: payload.fileName,
    contentType: payload.contentType,
    fileSize: payload.fileSize,
    partSize: payload.partSize,
    partCount: payload.partCount,
    status: 'uploading',
    metadata: payload.metadata ?? {},
    uploadToken,
    createdAt,
    expiresAt,
    completedFileId: null,
    error: null,
    completedAt: null,
    updatedAt: now,
  }
}

export async function createUploadPartUrls(params: {
  session: UploadSessionRecord
  partNumbers: number[]
  localOrigin: string
}): Promise<MultipartPartUrl[]> {
  assertUploadable(params.session)
  const unique = new Set(params.partNumbers)
  if (unique.size !== params.partNumbers.length) {
    throw new UploadSessionError('validation', 'partNumbers must not contain duplicates')
  }
  if (
    params.partNumbers.length === 0 ||
    params.partNumbers.length > MULTIPART_SESSION_MAX_PART_URLS
  ) {
    throw new UploadSessionError(
      'validation',
      `partNumbers must contain between 1 and ${MULTIPART_SESSION_MAX_PART_URLS} entries`
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
    key: params.session.storageKey,
    context: params.session.storageContext,
    partNumbers: params.partNumbers,
    localUrl: (partNumber) =>
      `${params.localOrigin}/api/v2/uploads/${params.session.id}/parts/${partNumber}?token=${encodeURIComponent(params.session.uploadToken)}`,
  })
}

export async function completeUploadSession<T>(params: {
  session: UploadSessionRecord
  parts: CompletedUploadPart[]
  finalize: (session: UploadSessionRecord) => Promise<{ value: T; completedFileId?: string }>
}): Promise<{ session: UploadSessionRecord; value: T; alreadyCompleted: boolean }> {
  assertUploadable(params.session)
  validateCompletedParts(params.session, params.parts)

  const existingObject = await headObject(params.session.storageKey, params.session.storageContext)
  const alreadyCompleted = existingObject?.size === params.session.fileSize
  if (existingObject && !alreadyCompleted) {
    throw new UploadSessionError(
      'conflict',
      `Upload object has ${existingObject.size} bytes; expected ${params.session.fileSize}`
    )
  }
  if (!alreadyCompleted) {
    await completeMultipartProviderUpload({
      provider: params.session.storageProvider,
      providerUploadId: params.session.providerUploadId,
      uploadId: params.session.id,
      key: params.session.storageKey,
      contentType: params.session.contentType,
      context: params.session.storageContext,
      parts: params.parts,
    })
  }

  const head = await headObject(params.session.storageKey, params.session.storageContext)
  if (!head) throw new Error('Completed upload object not found')
  if (head.size !== params.session.fileSize) {
    throw new UploadSessionError(
      'validation',
      `Uploaded object has ${head.size} bytes; expected ${params.session.fileSize}`
    )
  }

  const finalized = await params.finalize(params.session)
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
  await abortMultipartProviderUpload({
    provider: session.storageProvider,
    providerUploadId: session.providerUploadId,
    uploadId: session.id,
    key: session.storageKey,
    context: session.storageContext,
  })
  const completedAt = new Date()
  return { ...session, status: 'aborted', completedAt, updatedAt: completedAt }
}

export function expectedUploadPartSize(session: UploadSessionRecord, partNumber: number): number {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.partCount) {
    throw new UploadSessionError('validation', 'Invalid upload part number')
  }
  if (partNumber < session.partCount) return session.partSize
  return session.fileSize - session.partSize * (session.partCount - 1)
}

function assertUploadable(session: UploadSessionRecord): void {
  if (session.status !== 'uploading') {
    throw new UploadSessionError('conflict', `Upload session is ${session.status}`)
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UploadSessionError('conflict', 'Upload session has expired')
  }
}

function validateCompletedParts(session: UploadSessionRecord, parts: CompletedUploadPart[]): void {
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

function validateFileSize(fileSize: number): void {
  if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
    throw new UploadSessionError('validation', 'fileSize must be a positive integer')
  }
  if (fileSize > MAX_WORKSPACE_FILE_SIZE) {
    throw new UploadSessionError(
      'validation',
      `File size exceeds maximum of ${MAX_WORKSPACE_FILE_SIZE} bytes`
    )
  }
}
