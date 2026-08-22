import type { Principal } from '@sim/auth/principal'
import type { CreateInternalFileUploadBody } from '@/lib/api/contracts/upload-sessions'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveFolderPathIndex, resolveFolderPathFromIndex } from '@/lib/folders/queries'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  abortUploadSession,
  assertUploadSessionAuthBinding,
  completeUploadSession,
  createUploadPartUrls,
  createUploadSession,
  getOwnedUploadSession,
  getPrincipalUploadSession,
  type UploadSessionRecord,
  type UploadSessionTransfer,
} from '@/lib/uploads/upload-session/service'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { authorizeWorkspaceFileOperation } from '@/lib/workspace-files/application/workspace-operation-context'
import {
  finalizeUploadPurpose,
  finalizeWorkspaceFileUpload,
  loadCompletedUploadPurpose,
  loadCompletedWorkspaceFileUpload,
  type UploadActor,
} from '@/app/api/files/uploads/finalizers'
import {
  createPurposeUploadSession,
  reauthorizeUploadPurpose,
  reauthorizeWorkspaceUploadPurpose,
  resolveUploadAttributionUserId,
} from '@/app/api/files/uploads/purposes'

export interface WorkspaceFileUploadCreateInput {
  workspaceId: string
  name: string
  contentType: string
  size: number
  folderId?: string | null
  localOrigin: string
}

export interface UploadSessionControlInput {
  uploadId: string
  uploadToken: string
  workspaceId?: string
  localOrigin?: string
  partNumbers?: number[]
  actor?: UploadActor
}

export interface InternalUploadSessionControlInput extends UploadSessionControlInput {
  partNumbers?: number[]
}

export interface UploadSessionCreateResult {
  session: Awaited<ReturnType<typeof createUploadSession>>
}

/** Creates a workspace-file session after current principal authorization. */
export async function createWorkspaceFileUploadSession(
  principal: Principal,
  input: WorkspaceFileUploadCreateInput
): Promise<Awaited<ReturnType<typeof createUploadSession>>> {
  const userId = await resolveUploadAttributionUserId(principal, input.workspaceId)
  return createUploadSession({
    purpose: 'workspace_file',
    workspaceId: input.workspaceId,
    userId,
    principal,
    fileName: input.name,
    contentType: input.contentType,
    fileSize: input.size,
    metadata: { folderId: input.folderId ?? null },
    localOrigin: input.localOrigin,
  })
}

/** Internal purpose-aware create use case; authentication remains at the route adapter. */
export async function createInternalPurposeUploadSession(
  principal: Principal,
  body: CreateInternalFileUploadBody,
  request: OrchestrationRequestContext
): Promise<Awaited<ReturnType<typeof createUploadSession>>> {
  return createPurposeUploadSession(principal, body, requestOrigin(request))
}

/** Loads an internal session while binding workspace-file sessions to the principal. */
export async function loadAuthorizedInternalUploadSession(
  principal: Principal,
  input: UploadSessionControlInput
): Promise<UploadSessionRecord> {
  if (input.workspaceId !== undefined) return loadAuthorizedWorkspaceUploadSession(principal, input)
  const session = await getOwnedUploadSession({
    uploadId: input.uploadId,
    uploadToken: input.uploadToken,
    userId: principalUserId(principal),
  })
  if (session.purpose === 'workspace_file') assertUploadSessionAuthBinding(session, principal)
  return session
}

export async function issueInternalUploadPartUrls(
  principal: Principal,
  input: InternalUploadSessionControlInput,
  request: OrchestrationRequestContext
): Promise<{ parts: Awaited<ReturnType<typeof createUploadPartUrls>> }> {
  const session = await loadAuthorizedInternalUploadSession(principal, input)
  if (session.purpose === 'workspace_file') {
    await reauthorizeWorkspaceUploadPurpose(principal, session, fileOperations.uploadParts)
  } else {
    await reauthorizeUploadPurpose(principalUserId(principal), session)
  }
  return {
    parts: await createUploadPartUrls({
      session,
      partNumbers: input.partNumbers ?? [],
      localOrigin: requestOrigin(request),
    }),
  }
}

export async function abortInternalUploadSession(
  principal: Principal,
  input: UploadSessionControlInput
): Promise<UploadSessionRecord> {
  const session = await loadAuthorizedInternalUploadSession(principal, input)
  if (session.purpose === 'workspace_file') {
    await reauthorizeWorkspaceUploadPurpose(principal, session, fileOperations.uploadCancel)
  } else {
    await reauthorizeUploadPurpose(principalUserId(principal), session)
  }
  return abortUploadSession(session)
}

export async function completeInternalUploadSession(
  principal: Principal,
  input: UploadSessionControlInput,
  request: OrchestrationRequestContext
): Promise<{
  session: UploadSessionRecord
  value: import('@/app/api/files/uploads/finalizers').UploadPurposeResult
  alreadyCompleted: boolean
}> {
  const session = await loadAuthorizedInternalUploadSession(principal, input)
  const authorize = async (claimed: UploadSessionRecord) => {
    if (claimed.purpose === 'workspace_file') {
      await reauthorizeWorkspaceUploadPurpose(principal, claimed, fileOperations.uploadComplete)
    } else {
      await reauthorizeUploadPurpose(principalUserId(principal), claimed)
    }
  }
  await authorize(session)
  const actor: UploadActor = input.actor ?? { id: principalUserId(principal) }
  return completeUploadSession({
    session,
    loadCompleted: async (claimed) => {
      await authorize(claimed)
      return loadCompletedUploadPurpose(claimed)
    },
    finalize: async (claimed) => {
      await authorize(claimed)
      const finalized = await finalizeUploadPurpose({
        session: claimed,
        actor,
        request,
        principal,
        authorizeBeforeRegistration: () => authorize(claimed),
      })
      return { value: finalized.value, completedFileId: finalized.completedFileId }
    },
  })
}

/** Loads and binds a workspace-file session to the fresh authenticated principal. */
export async function loadAuthorizedWorkspaceUploadSession(
  principal: Principal,
  input: UploadSessionControlInput
): Promise<UploadSessionRecord> {
  return getPrincipalUploadSession({
    uploadId: input.uploadId,
    uploadToken: input.uploadToken,
    principal,
    workspaceId: input.workspaceId,
  })
}

/** Issues multipart URLs after current workspace authorization. */
export async function issueWorkspaceUploadPartUrls(
  principal: Principal,
  input: UploadSessionControlInput
): Promise<{ parts: Awaited<ReturnType<typeof createUploadPartUrls>> }> {
  const session = await loadAuthorizedWorkspaceUploadSession(principal, input)
  await reauthorizeWorkspaceUploadPurpose(principal, session, fileOperations.uploadParts)
  if (!input.localOrigin) throw new Error('Upload part URL issuance requires a local origin')
  const parts = await createUploadPartUrls({
    session,
    partNumbers: input.partNumbers ?? [],
    localOrigin: input.localOrigin,
  })
  return { parts }
}

/** Aborts an upload after current workspace authorization. */
export async function abortWorkspaceUploadSession(
  principal: Principal,
  input: UploadSessionControlInput
): Promise<UploadSessionRecord> {
  const session = await loadAuthorizedWorkspaceUploadSession(principal, input)
  await reauthorizeWorkspaceUploadPurpose(principal, session, fileOperations.uploadCancel)
  return abortUploadSession(session)
}

/**
 * Completes an upload and re-checks authorization immediately before durable
 * workspace-file registration. Completed retries use the durable session/file
 * result through the finalizer rather than registering a second file.
 */
export async function completeWorkspaceUploadSession(
  principal: Principal,
  input: UploadSessionControlInput,
  request: OrchestrationRequestContext
): Promise<{
  session: UploadSessionRecord
  value: WorkspaceFileRecord
  alreadyCompleted: boolean
}> {
  const session = await loadAuthorizedWorkspaceUploadSession(principal, input)
  await reauthorizeWorkspaceUploadPurpose(principal, session, fileOperations.uploadComplete)
  const actor: UploadActor = input.actor ?? {
    id: await resolveUploadAttributionUserId(principal, session.workspaceId ?? ''),
  }
  return completeUploadSession({
    session,
    loadCompleted: async (claimed) => {
      await reauthorizeWorkspaceUploadPurpose(principal, claimed, fileOperations.uploadComplete)
      return loadCompletedWorkspaceFileUpload(claimed)
    },
    finalize: async (claimed) => {
      await reauthorizeWorkspaceUploadPurpose(principal, claimed, fileOperations.uploadComplete)
      const finalized = await finalizeWorkspaceFileUpload({
        session: claimed,
        actor,
        request,
        source: 'api',
        principal,
        authorizeBeforeRegistration: async () => {
          await reauthorizeWorkspaceUploadPurpose(principal, claimed, fileOperations.uploadComplete)
        },
      })
      return { value: finalized.file, completedFileId: finalized.file.id }
    },
  })
}

export interface CreateWorkspaceFileUploadOperationInput {
  workspaceId: string
  name: string
  contentType: string
  size: number
  folderPath: string
}

export const createWorkspaceFileUploadOperation = {
  operation: fileOperations.uploadCreate,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: CreateWorkspaceFileUploadOperationInput
    request?: OrchestrationRequestContext
  }) {
    if (!request) throw new Error('Workspace upload creation requires a request context')
    await authorizeWorkspaceFileOperation(principal, fileOperations.uploadCreate, input.workspaceId)
    const folderIndex = await loadActiveFolderPathIndex(input.workspaceId, 'file')
    const folderId = resolveFolderPathFromIndex(folderIndex, input.folderPath)
    if (folderId === undefined) throw new OrchestrationError('not_found', 'Folder not found')
    return createWorkspaceFileUploadSession(principal, {
      workspaceId: input.workspaceId,
      name: input.name,
      contentType: input.contentType,
      size: input.size,
      folderId,
      localOrigin: requestOrigin(request),
    })
  },
} as const

export const issueWorkspaceFileUploadPartsOperation = {
  operation: fileOperations.uploadParts,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: UploadSessionControlInput
    request?: OrchestrationRequestContext
  }) {
    if (!request) throw new Error('Upload part URL issuance requires a request context')
    return issueWorkspaceUploadPartUrls(principal, {
      ...input,
      localOrigin: requestOrigin(request),
    })
  },
} as const

export const completeWorkspaceFileUploadOperation = {
  operation: fileOperations.uploadComplete,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: UploadSessionControlInput
    request?: OrchestrationRequestContext
  }) {
    if (!request) throw new Error('Upload completion requires a request context')
    return completeWorkspaceUploadSession(principal, input, request)
  },
} as const

export const abortWorkspaceFileUploadOperation = {
  operation: fileOperations.uploadCancel,
  async execute({ principal, input }: { principal: Principal; input: UploadSessionControlInput }) {
    return abortWorkspaceUploadSession(principal, input)
  },
} as const

function principalUserId(principal: Principal): string {
  if (principal.kind === 'session' || principal.kind === 'personal_api_key') {
    return principal.userId
  }
  throw new Error('Workspace upload attribution must be resolved from the current workspace owner')
}

export function requestOrigin(request: OrchestrationRequestContext & { nextUrl?: URL }): string {
  if (request.nextUrl instanceof URL) return request.nextUrl.origin
  const origin = request.headers.get('origin')
  if (origin) return origin
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https'
  if (!host) throw new Error('Upload signing requires a request origin')
  return `${protocol}://${host}`
}

export type { UploadSessionTransfer }
