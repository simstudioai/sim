import {
  type BoundWorkflowExecutionDelegatedPrincipal,
  isUserCredentialPrincipal,
  type Principal,
  requirePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { db, dbFor } from '@sim/db'
import { uploadSession } from '@sim/db/schema'
import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { generateSecureToken } from '@sim/security/tokens'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import {
  checkStorageQuotaForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateUniqueExecutionFileKey } from '@/lib/uploads/contexts/execution/utils'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
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
  listMultipartProviderParts,
  type UploadPartUrl,
  uploadStorageProvider,
} from '@/lib/uploads/upload-session/provider'
import type {
  UploadSessionPurpose,
  UploadSessionStatus,
  UploadStorageProvider,
  UploadTransferMethod,
} from '@/lib/uploads/upload-session/types'

export const UPLOAD_SESSION_PUT_MAX_BYTES = 50 * 1024 * 1024
export const UPLOAD_SESSION_PART_SIZE = 8 * 1024 * 1024
/**
 * Single-PUT ceiling for the `local` provider. A local PUT is proxied through an app route
 * rather than sent to object storage, so it must stay under the route's body limit; anything
 * larger goes multipart, whose parts are already sized to fit. Kept equal to
 * {@link UPLOAD_SESSION_PART_SIZE} but named separately so tuning part size for cloud
 * throughput cannot silently move the local proxy threshold.
 */
export const UPLOAD_SESSION_LOCAL_PUT_MAX_BYTES = UPLOAD_SESSION_PART_SIZE
export const UPLOAD_SESSION_MAX_PART_URLS = 100
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const UPLOAD_SESSION_ASSET_MAX_BYTES = 5 * 1024 * 1024

const PROCESSING_LEASE_MS = 5 * 60 * 1000
const CLEANUP_BATCH_SIZE = 100
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const cleanupDb = dbFor('cleanup')

export type { UploadSessionPurpose, UploadSessionStatus, UploadTransferMethod }

export type UploadSessionTransfer =
  | { method: 'put'; url: string; headers: Record<string, string>; expiresAt: string }
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
  storageKey: string
  finalKey: string
  storageProvider: UploadStorageProvider
  providerUploadId: string | null
  providerObjectVersion: string | null
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

/**
 * The credential that was authorized to create a protected upload session.
 *
 * This is deliberately kept in the existing JSON metadata column. It is
 * server-authored and immutable for the lifetime of the session; the upload
 * token only proves possession of the byte-plane capability and never grants
 * workspace access by itself.
 */
export interface UploadSessionAuthBinding {
  version: 1
  workspaceId: string
  principal:
    | { kind: 'session'; userId: string; sessionId: string }
    | { kind: 'personal_api_key'; userId: string; keyId: string }
    | { kind: 'oauth_access_token'; userId: string; clientId: string }
    | { kind: 'workspace_api_key'; workspaceId: string; keyId: string }
    | {
        kind: 'delegated'
        serviceId: 'executor'
        subjectUserId: string
        audience: string
        workflowId: string
        executionId?: string
      }
}

export interface CreatedUploadSession extends UploadSessionRecord {
  transfer: UploadSessionTransfer
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

function isExecutorWorkflowExecutionPrincipal(
  principal: Principal
): principal is BoundWorkflowExecutionDelegatedPrincipal {
  if (
    principal.kind !== 'delegated' ||
    principal.serviceId !== 'executor' ||
    !principal.delegationContext
  ) {
    return false
  }
  const context = principal.delegationContext
  return (
    typeof context === 'object' &&
    context !== null &&
    'kind' in context &&
    context.kind === 'workflow_execution' &&
    'workflowId' in context &&
    typeof context.workflowId === 'string' &&
    (!('executionId' in context) ||
      context.executionId === undefined ||
      typeof context.executionId === 'string')
  )
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
    | { purpose: 'workspace_file'; workspaceId: string; principal: Principal }
    | { purpose: 'table_import'; workspaceId: string; principal?: Principal }
    | {
        purpose: 'knowledge_document'
        workspaceId: string
        knowledgeBaseId: string
        principal: Principal
      }
    | { purpose: 'profile_picture'; workspaceId?: null }
    | { purpose: 'workspace_logo' | 'mothership_attachment'; workspaceId: string }
    | {
        purpose: 'execution_attachment'
        workspaceId: string
        workflowId: string
        executionId: string
      }
  )

type UploadSessionRow = typeof uploadSession.$inferSelect

export async function createUploadSession(
  params: CreateUploadSessionParams
): Promise<CreatedUploadSession> {
  validateFile(params)
  const id = params.id ?? generateId()
  const uploadToken = generateSecureToken(32)
  const workspaceId = params.purpose === 'profile_picture' ? null : params.workspaceId
  const metadata = { ...(params.metadata ?? {}) }
  if (params.purpose === 'workspace_file' || params.purpose === 'knowledge_document') {
    if (!workspaceId) throw new Error(`${params.purpose} upload is missing workspaceId`)
    if (!params.principal) {
      throw new Error(`${params.purpose} upload requires an authenticated principal`)
    }
    metadata.authBinding = createUploadSessionAuthBinding(params.principal, workspaceId)
  } else if (params.purpose === 'table_import' && params.principal) {
    if (!workspaceId) throw new Error('table_import upload is missing workspaceId')
    metadata.authBinding = createUploadSessionAuthBinding(params.principal, workspaceId, {
      executorDelegationAudience: 'sim:tables',
    })
  }
  const { storageContext, finalKey } = resolveUploadStorage(params, id)

  if (requiresStorageQuota(params.purpose)) {
    if (!workspaceId) throw new Error(`${params.purpose} upload is missing workspaceId`)
    const billingContext = await resolveStorageBillingContext(workspaceId)
    const quota = await checkStorageQuotaForBillingContext(billingContext, params.fileSize)
    if (!quota.allowed) {
      throw new UploadSessionError('payload_too_large', quota.error ?? 'Storage limit exceeded')
    }
  }

  const provider = uploadStorageProvider()
  const putMaxBytes =
    provider === 'local' ? UPLOAD_SESSION_LOCAL_PUT_MAX_BYTES : UPLOAD_SESSION_PUT_MAX_BYTES
  const method: UploadTransferMethod = params.fileSize <= putMaxBytes ? 'put' : 'multipart'
  const partSize = method === 'multipart' ? UPLOAD_SESSION_PART_SIZE : null
  const partCount =
    method === 'multipart' ? Math.ceil(params.fileSize / UPLOAD_SESSION_PART_SIZE) : null
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
          key: finalKey,
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
  let inserted: UploadSessionRow
  try {
    const rows = await db
      .insert(uploadSession)
      .values({
        id,
        tokenHash: sha256Hex(uploadToken),
        userId: params.userId,
        workspaceId,
        knowledgeBaseId: params.purpose === 'knowledge_document' ? params.knowledgeBaseId : null,
        workflowId: params.purpose === 'execution_attachment' ? params.workflowId : null,
        executionId: params.purpose === 'execution_attachment' ? params.executionId : null,
        purpose: params.purpose,
        method,
        storageContext,
        finalKey,
        storageProvider: provider,
        providerUploadId: initiated.providerUploadId,
        fileName: params.fileName,
        contentType: params.contentType,
        fileSize: params.fileSize,
        partSize,
        partCount,
        metadata,
        createdAt,
        expiresAt,
        updatedAt: createdAt,
      })
      .returning()
    inserted = requireRow(rows[0], 'Upload session insert returned no row')
  } catch (error) {
    await abortProviderUpload({
      provider,
      method,
      providerUploadId: initiated.providerUploadId,
      uploadId: id,
      key: finalKey,
      context: storageContext,
    })
    throw error
  }

  try {
    const transfer: UploadSessionTransfer =
      method === 'put'
        ? await createPutProviderTransfer({
            provider,
            key: finalKey,
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
    return { ...sessionFromRow(inserted, uploadToken), transfer }
  } catch (error) {
    await db.delete(uploadSession).where(eq(uploadSession.id, id))
    await abortProviderUpload({
      provider,
      method,
      providerUploadId: initiated.providerUploadId,
      uploadId: id,
      key: finalKey,
      context: storageContext,
    })
    throw error
  }
}

export async function getOwnedUploadSession(params: {
  uploadId: string
  uploadToken: string
  userId?: string
  workspaceId?: string | null
  purpose?: UploadSessionPurpose
  knowledgeBaseId?: string
  workflowId?: string
  executionId?: string
  principal?: Principal
}): Promise<UploadSessionRecord> {
  const [row] = await db
    .select()
    .from(uploadSession)
    .where(eq(uploadSession.id, params.uploadId))
    .limit(1)
  if (!row || !safeCompare(sha256Hex(params.uploadToken), row.tokenHash)) throw uploadNotFound()
  const session = sessionFromRow(row, params.uploadToken)
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
  if (params.principal && isPrincipalBoundUploadPurpose(session.purpose)) {
    assertUploadSessionAuthBinding(session, params.principal)
  }
  return session
}

/**
 * Loads a session using the signed token and verifies the immutable principal
 * binding for workspace-file control-plane requests.
 */
export async function getPrincipalUploadSession(params: {
  uploadId: string
  uploadToken: string
  principal: Principal
  workspaceId?: string
}): Promise<UploadSessionRecord> {
  const session = await getOwnedUploadSession({
    uploadId: params.uploadId,
    uploadToken: params.uploadToken,
    workspaceId: params.workspaceId,
    purpose: 'workspace_file',
    principal: params.principal,
  })
  return session
}

/** Loads a knowledge-document session using its immutable credential binding. */
export async function getPrincipalKnowledgeDocumentUploadSession(params: {
  uploadId: string
  uploadToken: string
  principal: Principal
  workspaceId: string
  knowledgeBaseId: string
}): Promise<UploadSessionRecord> {
  return getOwnedUploadSession({
    uploadId: params.uploadId,
    uploadToken: params.uploadToken,
    workspaceId: params.workspaceId,
    purpose: 'knowledge_document',
    knowledgeBaseId: params.knowledgeBaseId,
    principal: params.principal,
  })
}

export function createUploadSessionAuthBinding(
  principal: Principal,
  workspaceId: string,
  options: { executorDelegationAudience?: string } = {}
): UploadSessionAuthBinding {
  switch (principal.kind) {
    case 'session':
      return {
        version: 1,
        workspaceId,
        principal: {
          kind: principal.kind,
          userId: principal.userId,
          sessionId: principal.sessionId,
        },
      }
    case 'personal_api_key':
      return {
        version: 1,
        workspaceId,
        principal: { kind: principal.kind, userId: principal.userId, keyId: principal.keyId },
      }
    case 'oauth_access_token':
      return {
        version: 1,
        workspaceId,
        principal: { kind: principal.kind, userId: principal.userId, clientId: principal.clientId },
      }
    case 'workspace_api_key':
      if (principal.workspaceId !== workspaceId) {
        throw new UploadSessionError('forbidden', 'Workspace API key cannot access this workspace')
      }
      return {
        version: 1,
        workspaceId,
        principal: { kind: principal.kind, workspaceId, keyId: principal.keyId },
      }
    case 'delegated': {
      if (
        options.executorDelegationAudience === undefined ||
        !isExecutorWorkflowExecutionPrincipal(principal) ||
        principal.audience !== options.executorDelegationAudience ||
        principal.workspaceId !== workspaceId
      ) {
        throw new UploadSessionError('forbidden', 'Delegated principal cannot create this upload')
      }
      return {
        version: 1,
        workspaceId,
        principal: {
          kind: principal.kind,
          serviceId: principal.serviceId,
          subjectUserId: requirePrincipalSubjectUserId(principal),
          audience: principal.audience,
          workflowId: principal.delegationContext.workflowId,
          ...(principal.delegationContext.executionId
            ? { executionId: principal.delegationContext.executionId }
            : {}),
        },
      }
    }
    case 'credential_group_enrollment':
      throw new UploadSessionError(
        'forbidden',
        'Credential Group enrollment principals cannot create uploads'
      )
    case 'scim_connection':
      throw new UploadSessionError(
        'forbidden',
        'Directory provisioning credentials cannot create uploads'
      )
    case 'system':
      throw new UploadSessionError('forbidden', 'System principals cannot create uploads')
  }
}

export function assertUploadSessionAuthBinding(
  session: UploadSessionRecord,
  principal: Principal
): void {
  if (!isPrincipalBoundUploadPurpose(session.purpose)) return
  const candidate = session.metadata.authBinding
  if (candidate === undefined) {
    if (session.purpose === 'table_import') throw uploadNotFound()
    assertLegacyUploadSessionOwner(session, principal)
    return
  }
  if (!isUploadSessionAuthBinding(candidate) || candidate.workspaceId !== session.workspaceId) {
    throw uploadNotFound()
  }
  const bound = candidate.principal
  const matches =
    bound.kind === principal.kind &&
    (bound.kind === 'session'
      ? principal.kind === 'session' &&
        bound.userId === principal.userId &&
        bound.sessionId === principal.sessionId
      : bound.kind === 'personal_api_key'
        ? principal.kind === 'personal_api_key' &&
          bound.userId === principal.userId &&
          bound.keyId === principal.keyId
        : bound.kind === 'oauth_access_token'
          ? principal.kind === 'oauth_access_token' &&
            bound.userId === principal.userId &&
            bound.clientId === principal.clientId
          : bound.kind === 'workspace_api_key'
            ? principal.kind === 'workspace_api_key' &&
              bound.workspaceId === principal.workspaceId &&
              bound.keyId === principal.keyId
            : isExecutorWorkflowExecutionPrincipal(principal) &&
              principal.workspaceId === session.workspaceId &&
              principal.subjectUserId === bound.subjectUserId &&
              principal.audience === bound.audience &&
              principal.delegationContext.workflowId === bound.workflowId &&
              principal.delegationContext.executionId === bound.executionId)
  if (!matches) throw uploadNotFound()
}

/**
 * Preserves control access for the bounded set of sessions created before
 * immutable credential bindings shipped. New protected sessions always persist
 * `authBinding`, and malformed bindings never enter this compatibility path.
 * The upload token and current workspace authorization are still checked by the
 * calling control-plane use case.
 */
function assertLegacyUploadSessionOwner(session: UploadSessionRecord, principal: Principal): void {
  const matches =
    principal.kind === 'workspace_api_key'
      ? principal.workspaceId === session.workspaceId
      : (principal.kind === 'session' || isUserCredentialPrincipal(principal)) &&
        principal.userId === session.userId
  if (!matches) throw uploadNotFound()
}

export async function verifyUploadSessionToken(uploadToken: string): Promise<UploadSessionRecord> {
  const tokenHash = sha256Hex(uploadToken)
  const [row] = await db
    .select()
    .from(uploadSession)
    .where(eq(uploadSession.tokenHash, tokenHash))
    .limit(1)
  if (!row || !safeCompare(tokenHash, row.tokenHash)) {
    throw new UploadSessionError('forbidden', 'Invalid or expired upload token')
  }
  return sessionFromRow(row, uploadToken)
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
    key: params.session.finalKey,
    context: params.session.storageContext,
    partNumbers: params.partNumbers,
    localUrl: (partNumber) =>
      `${params.localOrigin}/api/v2/uploads/${params.session.id}/parts/${partNumber}?token=${encodeURIComponent(params.session.uploadToken)}`,
  })
}

export async function completeUploadSession<T>(params: {
  session: UploadSessionRecord
  finalize: (session: UploadSessionRecord) => Promise<{ value: T; completedFileId?: string }>
  loadCompleted?: (session: UploadSessionRecord) => Promise<T>
}): Promise<{ session: UploadSessionRecord; value: T; alreadyCompleted: boolean }> {
  if (params.session.status === 'completed') {
    if (params.loadCompleted && params.session.completedFileId) {
      return {
        session: params.session,
        value: await params.loadCompleted(params.session),
        alreadyCompleted: true,
      }
    }
    const finalized = await params.finalize(params.session)
    return { session: params.session, value: finalized.value, alreadyCompleted: true }
  }
  if (
    params.session.status !== 'uploading' &&
    params.session.status !== 'completing' &&
    params.session.status !== 'finalizing'
  ) {
    throw new UploadSessionError('conflict', `Upload session is ${params.session.status}`)
  }
  if (params.session.status === 'uploading') assertNotExpired(params.session)
  const leaseId = generateId()
  const recoveringFinalization = params.session.status === 'finalizing'
  const claimed = {
    ...(await claimSession(
      params.session.id,
      leaseId,
      recoveringFinalization ? ['finalizing'] : ['uploading', 'completing'],
      recoveringFinalization ? 'finalizing' : 'completing'
    )),
    uploadToken: params.session.uploadToken,
  }
  let phase: 'completing' | 'finalizing' = recoveringFinalization ? 'finalizing' : 'completing'
  let alreadyCompleted = false

  try {
    if (recoveringFinalization && claimed.completedFileId && params.loadCompleted) {
      const value = await params.loadCompleted(claimed)
      const completed = await markUploadSessionCompleted(claimed, leaseId, claimed.completedFileId)
      return { session: completed, value, alreadyCompleted: true }
    }

    let finalObject = await headProviderObject({
      provider: claimed.storageProvider,
      key: claimed.finalKey,
      context: claimed.storageContext,
    })
    alreadyCompleted = finalObject !== null
    if (finalObject) assertObjectIdentity(claimed, finalObject, 'Final')

    if (!finalObject) {
      if (claimed.method === 'put') {
        throw new UploadSessionError('conflict', 'Uploaded object not found')
      }
      const providerParts = await listMultipartProviderParts({
        provider: claimed.storageProvider,
        providerUploadId: claimed.providerUploadId,
        uploadId: claimed.id,
        key: claimed.finalKey,
        context: claimed.storageContext,
      })
      const parts = validatedSortedProviderParts(claimed, providerParts)
      try {
        await completeMultipartProviderUpload({
          provider: claimed.storageProvider,
          providerUploadId: claimed.providerUploadId,
          uploadId: claimed.id,
          key: claimed.finalKey,
          contentType: claimed.contentType,
          context: claimed.storageContext,
          parts,
          metadata: uploadSessionObjectMetadata(claimed),
        })
      } catch (error) {
        finalObject = await headProviderObject({
          provider: claimed.storageProvider,
          key: claimed.finalKey,
          context: claimed.storageContext,
        })
        if (!finalObject) throw error
      }
      finalObject =
        finalObject ??
        (await headProviderObject({
          provider: claimed.storageProvider,
          key: claimed.finalKey,
          context: claimed.storageContext,
        }))
      if (!finalObject) throw new Error('Completed upload object not found')
      assertObjectIdentity(claimed, finalObject, 'Completed')
    }

    phase = 'finalizing'
    const [finalizingRow] = await db
      .update(uploadSession)
      .set({
        status: 'finalizing',
        providerObjectVersion: finalObject.version,
        error: null,
        updatedAt: new Date(),
      })
      .where(and(eq(uploadSession.id, claimed.id), eq(uploadSession.processingLeaseId, leaseId)))
      .returning()
    const finalizing = sessionFromRow(
      requireRow(finalizingRow, 'Upload completion lease was lost'),
      claimed.uploadToken
    )
    const finalized = await params.finalize(finalizing)
    const completed = await markUploadSessionCompleted(
      claimed,
      leaseId,
      finalized.completedFileId ?? null
    )
    return {
      session: completed,
      value: finalized.value,
      alreadyCompleted,
    }
  } catch (error) {
    await db
      .update(uploadSession)
      .set({
        status: phase === 'completing' && error instanceof UploadSessionError ? 'uploading' : phase,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        error: getErrorMessage(error),
        updatedAt: new Date(),
      })
      .where(and(eq(uploadSession.id, claimed.id), eq(uploadSession.processingLeaseId, leaseId)))
    throw error
  }
}

/**
 * The completion marker is only written when the finalizer reports one. A
 * finalizer that instead records it inside its own registration transaction —
 * see `markUploadSessionFileRegistered` — keeps that value: clearing it would
 * let the abort guard and the expiry sweep treat a session whose durable
 * resource already exists as disposable.
 */
async function markUploadSessionCompleted(
  session: UploadSessionRecord,
  leaseId: string,
  completedFileId: string | null
): Promise<UploadSessionRecord> {
  const completedAt = new Date()
  const [completedRow] = await db
    .update(uploadSession)
    .set({
      status: 'completed',
      ...(completedFileId !== null ? { completedFileId } : {}),
      completedAt,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
      error: null,
      updatedAt: completedAt,
    })
    .where(and(eq(uploadSession.id, session.id), eq(uploadSession.processingLeaseId, leaseId)))
    .returning()
  return sessionFromRow(
    requireRow(completedRow, 'Upload completion lease was lost'),
    session.uploadToken
  )
}

export async function abortUploadSession(
  session: UploadSessionRecord
): Promise<UploadSessionRecord> {
  if (session.status === 'aborted' || session.status === 'expired') return session
  if (session.status === 'completed') {
    throw new UploadSessionError('conflict', 'Completed upload sessions cannot be aborted')
  }
  if (session.status === 'finalizing' && session.completedFileId) {
    throw new UploadSessionError(
      'conflict',
      'Finalizing upload sessions with a registered file cannot be aborted'
    )
  }
  if (
    session.status !== 'uploading' &&
    session.status !== 'completing' &&
    session.status !== 'aborting' &&
    session.status !== 'finalizing'
  ) {
    throw new UploadSessionError('conflict', `Upload session is ${session.status}`)
  }
  const leaseId = generateId()
  const claimed = {
    ...(await claimSession(
      session.id,
      leaseId,
      ['uploading', 'completing', 'aborting', 'finalizing'],
      'aborting'
    )),
    uploadToken: session.uploadToken,
  }
  try {
    await discardIncompleteProviderState(claimed)
    const completedAt = new Date()
    const [row] = await db
      .update(uploadSession)
      .set({
        status: 'aborted',
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        completedAt,
        error: null,
        updatedAt: completedAt,
      })
      .where(and(eq(uploadSession.id, claimed.id), eq(uploadSession.processingLeaseId, leaseId)))
      .returning()
    return sessionFromRow(requireRow(row, 'Upload abort lease was lost'), session.uploadToken)
  } catch (error) {
    await db
      .update(uploadSession)
      .set({
        status: 'aborting',
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        error: getErrorMessage(error),
        updatedAt: new Date(),
      })
      .where(and(eq(uploadSession.id, claimed.id), eq(uploadSession.processingLeaseId, leaseId)))
    throw error
  }
}

export async function cleanupExpiredUploadSessions(): Promise<{
  expired: number
  failed: number
  purged: number
}> {
  const now = new Date()
  const candidates = await cleanupDb
    .select()
    .from(uploadSession)
    .where(
      and(
        or(
          inArray(uploadSession.status, ['uploading', 'completing', 'aborting']),
          and(eq(uploadSession.status, 'finalizing'), isNull(uploadSession.completedFileId))
        ),
        lt(uploadSession.expiresAt, now),
        or(
          isNull(uploadSession.processingLeaseId),
          isNull(uploadSession.processingLeaseExpiresAt),
          lt(uploadSession.processingLeaseExpiresAt, now)
        )
      )
    )
    .orderBy(asc(uploadSession.expiresAt))
    .limit(CLEANUP_BATCH_SIZE)

  let expired = 0
  let failed = 0
  for (const candidate of candidates) {
    const leaseId = generateId()
    try {
      const claimed = await claimSession(
        candidate.id,
        leaseId,
        ['uploading', 'completing', 'aborting', 'finalizing'],
        'aborting',
        cleanupDb
      )
      await discardIncompleteProviderState(claimed)
      const completedAt = new Date()
      const updated = await cleanupDb
        .update(uploadSession)
        .set({
          status: 'expired',
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          completedAt,
          error: null,
          updatedAt: completedAt,
        })
        .where(and(eq(uploadSession.id, claimed.id), eq(uploadSession.processingLeaseId, leaseId)))
        .returning({ id: uploadSession.id })
      if (updated.length !== 1) throw new Error('Upload expiry lease was lost')
      expired++
    } catch (error) {
      failed++
      await cleanupDb
        .update(uploadSession)
        .set({
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          error: getErrorMessage(error),
          updatedAt: new Date(),
        })
        .where(
          and(eq(uploadSession.id, candidate.id), eq(uploadSession.processingLeaseId, leaseId))
        )
    }
  }

  const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS)
  const terminalRows = await cleanupDb
    .select()
    .from(uploadSession)
    .where(
      and(
        inArray(uploadSession.status, ['completed', 'aborted', 'expired']),
        lt(uploadSession.completedAt, terminalCutoff),
        or(
          isNull(uploadSession.processingLeaseId),
          isNull(uploadSession.processingLeaseExpiresAt),
          lt(uploadSession.processingLeaseExpiresAt, now)
        )
      )
    )
    .orderBy(asc(uploadSession.completedAt))
    .limit(CLEANUP_BATCH_SIZE)
  let purged = 0
  for (const candidate of terminalRows) {
    const leaseId = generateId()
    try {
      const claimed = await claimSession(
        candidate.id,
        leaseId,
        [candidate.status],
        candidate.status,
        cleanupDb
      )
      if (claimed.status === 'aborted' || claimed.status === 'expired') {
        await deleteOwnedFinalObject(claimed)
      } else if (claimed.status !== 'completed') {
        throw new Error(`Invalid terminal upload status ${claimed.status}`)
      }
      const deleted = await cleanupDb
        .delete(uploadSession)
        .where(and(eq(uploadSession.id, claimed.id), eq(uploadSession.processingLeaseId, leaseId)))
        .returning({ id: uploadSession.id })
      if (deleted.length !== 1) throw new Error('Upload retention lease was lost')
      purged++
    } catch (error) {
      failed++
      await cleanupDb
        .update(uploadSession)
        .set({
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          error: getErrorMessage(error),
          updatedAt: new Date(),
        })
        .where(
          and(eq(uploadSession.id, candidate.id), eq(uploadSession.processingLeaseId, leaseId))
        )
    }
  }

  return { expired, failed, purged }
}

export function expectedUploadPartSize(session: UploadSessionRecord, partNumber: number): number {
  if (session.method !== 'multipart' || !session.partSize || !session.partCount) {
    throw new UploadSessionError('conflict', 'PUT upload sessions do not have multipart parts')
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.partCount) {
    throw new UploadSessionError(
      'validation',
      `partNumber must be between 1 and ${session.partCount}`
    )
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

function sessionFromRow(row: UploadSessionRow, uploadToken: string): UploadSessionRecord {
  if (!isStorageContext(row.storageContext)) {
    throw new Error(`Invalid upload storage context ${row.storageContext}`)
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    knowledgeBaseId: row.knowledgeBaseId,
    workflowId: row.workflowId,
    executionId: row.executionId,
    purpose: row.purpose,
    method: row.method,
    storageContext: row.storageContext,
    storageKey: row.finalKey,
    finalKey: row.finalKey,
    storageProvider: row.storageProvider,
    providerUploadId: row.providerUploadId,
    providerObjectVersion: row.providerObjectVersion,
    fileName: row.fileName,
    contentType: row.contentType,
    fileSize: row.fileSize,
    partSize: row.partSize,
    partCount: row.partCount,
    status: row.status,
    metadata: row.metadata,
    uploadToken,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedFileId: row.completedFileId,
    error: row.error,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  }
}

async function claimSession(
  id: string,
  leaseId: string,
  statuses: UploadSessionStatus[],
  nextStatus: UploadSessionStatus = 'completing',
  database: typeof db = db
): Promise<UploadSessionRecord> {
  const now = new Date()
  const [row] = await database
    .update(uploadSession)
    .set({
      status: nextStatus,
      processingLeaseId: leaseId,
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      error: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(uploadSession.id, id),
        inArray(uploadSession.status, statuses),
        or(
          isNull(uploadSession.processingLeaseId),
          isNull(uploadSession.processingLeaseExpiresAt),
          lt(uploadSession.processingLeaseExpiresAt, now)
        )
      )
    )
    .returning()
  if (!row) throw new UploadSessionError('conflict', 'Upload session is already being processed')
  return sessionFromRow(row, '')
}

function validatedSortedProviderParts(
  session: UploadSessionRecord,
  parts: CompletedUploadPart[]
): CompletedUploadPart[] {
  if (!session.partCount) throw new Error('Multipart upload is missing partCount')
  if (parts.length !== session.partCount) {
    throw new UploadSessionError(
      'conflict',
      `Expected ${session.partCount} uploaded parts; provider returned ${parts.length}`
    )
  }
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  for (let index = 0; index < sorted.length; index++) {
    const part = sorted[index]
    if (part.partNumber !== index + 1) {
      throw new UploadSessionError(
        'conflict',
        'Provider parts must contain every part exactly once'
      )
    }
    const expectedSize = expectedUploadPartSize(session, part.partNumber)
    if (part.size !== expectedSize) {
      throw new UploadSessionError(
        'conflict',
        `Provider part ${part.partNumber} has ${part.size} bytes; expected ${expectedSize}`
      )
    }
    if ((session.storageProvider === 's3' || session.storageProvider === 'gcs') && !part.etag) {
      throw new UploadSessionError(
        'conflict',
        `${session.storageProvider} part ${part.partNumber} is missing an ETag`
      )
    }
  }
  return sorted
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

async function deleteOwnedFinalObject(session: UploadSessionRecord): Promise<void> {
  const object = await headProviderObject({
    provider: session.storageProvider,
    key: session.finalKey,
    context: session.storageContext,
  })
  if (!object) return
  assertObjectIdentity(session, object, 'Final')
  await deleteProviderObjectVersion({
    provider: session.storageProvider,
    key: session.finalKey,
    version: object.version,
    context: session.storageContext,
  })
}

async function discardIncompleteProviderState(session: UploadSessionRecord): Promise<void> {
  const object = await headProviderObject({
    provider: session.storageProvider,
    key: session.finalKey,
    context: session.storageContext,
  })
  if (object) {
    assertObjectIdentity(session, object, 'Final')
    await deleteProviderObjectVersion({
      provider: session.storageProvider,
      key: session.finalKey,
      version: object.version,
      context: session.storageContext,
    })
    return
  }
  await abortProviderUpload({
    provider: session.storageProvider,
    method: session.method,
    providerUploadId: session.providerUploadId,
    uploadId: session.id,
    key: session.finalKey,
    context: session.storageContext,
  })
}

function assertUploadable(session: UploadSessionRecord): void {
  if (session.status !== 'uploading') {
    throw new UploadSessionError('conflict', `Upload session is ${session.status}`)
  }
  assertNotExpired(session)
}

function assertNotExpired(session: UploadSessionRecord): void {
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UploadSessionError('conflict', 'Upload session has expired')
  }
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
  if (purpose === 'execution_attachment') return MAX_WORKSPACE_FORMDATA_FILE_SIZE
  return MAX_WORKSPACE_FILE_SIZE
}

function requiresStorageQuota(purpose: UploadSessionPurpose): boolean {
  return purpose === 'workspace_file' || purpose === 'knowledge_document'
}

function isPrincipalBoundUploadPurpose(purpose: UploadSessionPurpose): boolean {
  return (
    purpose === 'workspace_file' || purpose === 'knowledge_document' || purpose === 'table_import'
  )
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
        finalKey: `table-import/${params.workspaceId}/${id}/${buildStorageKeySegment('', params.fileName)}`,
      }
    case 'knowledge_document':
      return {
        storageContext: 'knowledge-base',
        finalKey: generateKnowledgeBaseFileKey(params.fileName),
      }
    case 'profile_picture':
      return {
        storageContext: 'profile-pictures',
        finalKey: `profile-pictures/${buildStorageKeySegment(`${id}-`, params.fileName)}`,
      }
    case 'workspace_logo':
      return {
        storageContext: 'workspace-logos',
        finalKey: `workspace-logos/${params.workspaceId}/${buildStorageKeySegment(`${id}-`, params.fileName)}`,
      }
    case 'mothership_attachment':
      return {
        storageContext: 'mothership',
        finalKey: generateWorkspaceFileKey(params.workspaceId, params.fileName),
      }
    case 'execution_attachment':
      return {
        storageContext: 'execution',
        finalKey: generateUniqueExecutionFileKey(
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

function isStorageContext(value: string): value is StorageContext {
  return [
    'workspace',
    'table-import',
    'knowledge-base',
    'profile-pictures',
    'workspace-logos',
    'mothership',
    'execution',
  ].includes(value)
}

function isUploadSessionAuthBinding(value: unknown): value is UploadSessionAuthBinding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Record<string, unknown>
  if (binding.version !== 1 || typeof binding.workspaceId !== 'string') return false
  if (!binding.principal || typeof binding.principal !== 'object') return false
  const principal = binding.principal as Record<string, unknown>
  if (principal.kind === 'session') {
    return typeof principal.userId === 'string' && typeof principal.sessionId === 'string'
  }
  if (principal.kind === 'personal_api_key') {
    return typeof principal.userId === 'string' && typeof principal.keyId === 'string'
  }
  if (principal.kind === 'oauth_access_token') {
    return typeof principal.userId === 'string' && typeof principal.clientId === 'string'
  }
  if (principal.kind === 'delegated') {
    return (
      principal.serviceId === 'executor' &&
      typeof principal.subjectUserId === 'string' &&
      typeof principal.audience === 'string' &&
      typeof principal.workflowId === 'string' &&
      (principal.executionId === undefined || typeof principal.executionId === 'string')
    )
  }
  return (
    principal.kind === 'workspace_api_key' &&
    typeof principal.workspaceId === 'string' &&
    typeof principal.keyId === 'string'
  )
}

function uploadNotFound(): UploadSessionError {
  return new UploadSessionError('not_found', 'Upload session not found')
}

function requireNumber(value: number | null): number {
  if (value === null) throw new Error('Multipart upload geometry is missing')
  return value
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message)
  return row
}
