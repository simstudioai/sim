import { db } from '@sim/db'
import { tableImports, uploadSessions } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, lt } from 'drizzle-orm'
import {
  checkStorageQuotaForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace'
import { deleteFile, headObject } from '@/lib/uploads/core/storage-service'
import { signUploadToken } from '@/lib/uploads/core/upload-token'
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
export type UploadSessionStatus =
  | 'uploading'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'expired'

export type UploadSessionRecord = typeof uploadSessions.$inferSelect

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
  const context: StorageContext = params.purpose === 'workspace_file' ? 'workspace' : 'table-import'
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
    context,
    localUploadId: id,
  })

  try {
    const [created] = await db
      .insert(uploadSessions)
      .values({
        id,
        workspaceId: params.workspaceId,
        userId: params.userId,
        purpose: params.purpose,
        storageContext: context,
        storageKey,
        storageProvider: initiated.provider,
        providerUploadId: initiated.providerUploadId,
        fileName: params.fileName,
        contentType: params.contentType,
        fileSize: params.fileSize,
        partSize: MULTIPART_SESSION_PART_SIZE,
        partCount,
        status: 'uploading',
        metadata: params.metadata ?? {},
        expiresAt: new Date(Date.now() + MULTIPART_SESSION_TTL_MS),
      })
      .returning()
    if (!created) throw new Error('Upload session insert returned no row')
    return created
  } catch (error) {
    await abortMultipartProviderUpload({
      provider: initiated.provider,
      providerUploadId: initiated.providerUploadId,
      uploadId: id,
      key: storageKey,
      context,
    }).catch(() => {})
    throw error
  }
}

export async function getOwnedUploadSession(params: {
  uploadId: string
  workspaceId: string
  userId?: string
}): Promise<UploadSessionRecord> {
  const conditions = [
    eq(uploadSessions.id, params.uploadId),
    eq(uploadSessions.workspaceId, params.workspaceId),
  ]
  if (params.userId) conditions.push(eq(uploadSessions.userId, params.userId))
  const [session] = await db
    .select()
    .from(uploadSessions)
    .where(and(...conditions))
    .limit(1)
  if (!session) throw new UploadSessionError('not_found', 'Upload session not found')
  return session
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

  const context = storageContext(params.session)
  const token = signUploadToken({
    uploadId: params.session.id,
    key: params.session.storageKey,
    userId: params.session.userId,
    workspaceId: params.session.workspaceId,
    context,
  })
  return getMultipartProviderPartUrls({
    provider: storageProvider(params.session),
    providerUploadId: params.session.providerUploadId,
    key: params.session.storageKey,
    context,
    partNumbers: params.partNumbers,
    localUrl: (partNumber) =>
      `${params.localOrigin}/api/v2/uploads/${params.session.id}/parts/${partNumber}?token=${encodeURIComponent(token)}`,
  })
}

export async function completeUploadSession<T>(params: {
  session: UploadSessionRecord
  parts: CompletedUploadPart[]
  finalize: (session: UploadSessionRecord) => Promise<{ value: T; completedFileId?: string }>
  onFailure?: (session: UploadSessionRecord, error: unknown) => Promise<void>
}): Promise<{ session: UploadSessionRecord; value: T | null; alreadyCompleted: boolean }> {
  if (params.session.status === 'completed') {
    return { session: params.session, value: null, alreadyCompleted: true }
  }
  assertUploadable(params.session)
  validateCompletedParts(params.session, params.parts)

  const [claimed] = await db
    .update(uploadSessions)
    .set({ status: 'finalizing', updatedAt: new Date() })
    .where(and(eq(uploadSessions.id, params.session.id), eq(uploadSessions.status, 'uploading')))
    .returning()
  if (!claimed) {
    throw new UploadSessionError('conflict', 'Upload session is no longer uploadable')
  }

  const context = storageContext(claimed)
  let objectCompleted = false
  try {
    await completeMultipartProviderUpload({
      provider: storageProvider(claimed),
      providerUploadId: claimed.providerUploadId,
      uploadId: claimed.id,
      key: claimed.storageKey,
      contentType: claimed.contentType,
      context,
      parts: params.parts,
    })
    objectCompleted = true
    const head = await headObject(claimed.storageKey, context)
    if (!head) throw new Error('Completed upload object not found')
    if (head.size !== claimed.fileSize) {
      throw new UploadSessionError(
        'validation',
        `Uploaded object has ${head.size} bytes; expected ${claimed.fileSize}`
      )
    }

    const finalized = await params.finalize(claimed)
    const now = new Date()
    const [completed] = await db
      .update(uploadSessions)
      .set({
        status: 'completed',
        completedFileId: finalized.completedFileId,
        error: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(uploadSessions.id, claimed.id), eq(uploadSessions.status, 'finalizing')))
      .returning()
    if (!completed) throw new Error('Upload session completion state was lost')
    return { session: completed, value: finalized.value, alreadyCompleted: false }
  } catch (error) {
    if (objectCompleted) {
      await deleteFile({ key: claimed.storageKey, context }).catch(() => {})
    } else {
      await abortMultipartProviderUpload({
        provider: storageProvider(claimed),
        providerUploadId: claimed.providerUploadId,
        uploadId: claimed.id,
        key: claimed.storageKey,
        context,
      }).catch(() => {})
    }
    await db
      .update(uploadSessions)
      .set({ status: 'failed', error: getErrorMessage(error), updatedAt: new Date() })
      .where(eq(uploadSessions.id, claimed.id))
    await params.onFailure?.(claimed, error)
    throw error
  }
}

export async function abortUploadSession(
  session: UploadSessionRecord
): Promise<UploadSessionRecord> {
  if (session.status === 'aborted') return session
  if (session.status === 'completed') {
    throw new UploadSessionError('conflict', 'Completed uploads cannot be aborted')
  }
  if (session.status !== 'uploading') {
    throw new UploadSessionError('conflict', `Upload session is ${session.status}`)
  }
  const [claimed] = await db
    .update(uploadSessions)
    .set({ status: 'finalizing', updatedAt: new Date() })
    .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, 'uploading')))
    .returning()
  if (!claimed) throw new UploadSessionError('conflict', 'Upload session is no longer uploadable')
  try {
    await abortMultipartProviderUpload({
      provider: storageProvider(claimed),
      providerUploadId: claimed.providerUploadId,
      uploadId: claimed.id,
      key: claimed.storageKey,
      context: storageContext(claimed),
    })
    const now = new Date()
    const [aborted] = await db
      .update(uploadSessions)
      .set({ status: 'aborted', completedAt: now, updatedAt: now })
      .where(eq(uploadSessions.id, claimed.id))
      .returning()
    if (!aborted) throw new Error('Upload session abort state was lost')
    return aborted
  } catch (error) {
    await db
      .update(uploadSessions)
      .set({ status: 'failed', error: getErrorMessage(error), updatedAt: new Date() })
      .where(eq(uploadSessions.id, claimed.id))
    throw error
  }
}

export async function expireUploadSessions(now = new Date(), limit = 100): Promise<number> {
  const expired = await db
    .select()
    .from(uploadSessions)
    .where(
      and(
        inArray(uploadSessions.status, ['uploading', 'finalizing']),
        lt(uploadSessions.expiresAt, now)
      )
    )
    .orderBy(uploadSessions.expiresAt)
    .limit(limit)
  for (const session of expired) {
    if (session.status === 'uploading') {
      await abortMultipartProviderUpload({
        provider: storageProvider(session),
        providerUploadId: session.providerUploadId,
        uploadId: session.id,
        key: session.storageKey,
        context: storageContext(session),
      })
    } else {
      await abortMultipartProviderUpload({
        provider: storageProvider(session),
        providerUploadId: session.providerUploadId,
        uploadId: session.id,
        key: session.storageKey,
        context: storageContext(session),
      }).catch(() => {})
      await deleteFile({ key: session.storageKey, context: storageContext(session) }).catch(
        () => {}
      )
    }
    await db
      .update(uploadSessions)
      .set({ status: 'expired', completedAt: now, updatedAt: now })
      .where(
        and(
          eq(uploadSessions.id, session.id),
          inArray(uploadSessions.status, ['uploading', 'finalizing'])
        )
      )
    if (session.purpose === 'table_import') {
      await db
        .update(tableImports)
        .set({ status: 'expired', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(tableImports.uploadSessionId, session.id),
            inArray(tableImports.status, ['uploading', 'preparing'])
          )
        )
    }
  }
  return expired.length
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
  const provider = storageProvider(session)
  for (let index = 0; index < sorted.length; index++) {
    if (sorted[index].partNumber !== index + 1) {
      throw new UploadSessionError(
        'validation',
        'Completed parts must contain every part exactly once'
      )
    }
    if ((provider === 's3' || provider === 'gcs') && !sorted[index].etag) {
      throw new UploadSessionError(
        'validation',
        `etag is required for ${provider} part ${sorted[index].partNumber}`
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

function storageContext(session: UploadSessionRecord): StorageContext {
  if (session.storageContext !== 'workspace' && session.storageContext !== 'table-import') {
    throw new Error(`Unsupported upload session storage context: ${session.storageContext}`)
  }
  return session.storageContext
}

function storageProvider(session: UploadSessionRecord): MultipartStorageProvider {
  if (
    session.storageProvider !== 's3' &&
    session.storageProvider !== 'blob' &&
    session.storageProvider !== 'gcs' &&
    session.storageProvider !== 'local'
  ) {
    throw new Error(`Unsupported upload session storage provider: ${session.storageProvider}`)
  }
  return session.storageProvider
}
