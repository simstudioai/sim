import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import {
  type ProjectStorageBillingContext,
  resolveProjectStorageBillingContext,
} from '@/lib/billing/storage/context'
import { checkStorageQuotaForBillingContext } from '@/lib/billing/storage/limits'
import {
  maybeNotifyStorageLimitForBillingContext,
  prepareProjectStorageMutationInTx,
} from '@/lib/billing/storage/tracking'
import type { AuthorizingUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import {
  createProjectFileAuthorizer,
  type ProjectFileAuthorizationContext,
  type ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import {
  type ProjectFileOperation,
  projectFileOperations,
} from '@/lib/projects/files/application/operations'
import {
  projectUploadCleanupAvailableAt,
  queueRetiredProjectUploadCleanup,
} from '@/lib/projects/files/prefix-cleanup'
import {
  buildWorkspaceFileFolderPathMap,
  listFileFolders,
  resolveFileFolderTarget,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  adoptVerifiedUploadSession,
  commitFileCreateInTx,
  discardStagedFileContent,
  mapFileRecord,
  type StagedFileContent,
  stageFileContent,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  enqueueWorkspaceFileStorageCleanups,
  processWorkspaceFileStorageCleanupsNow,
} from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { requestOrigin } from '@/lib/uploads/upload-session/application'
import { assertProjectFileUploadBinding } from '@/lib/uploads/upload-session/project-file-binding'
import { readProjectFileUploadProvenance } from '@/lib/uploads/upload-session/project-file-provenance'
import {
  abortUploadSession,
  type CreatedUploadSession,
  completeUploadSession,
  createUploadPartUrls,
  createUploadSession,
  getOwnedUploadSession,
  lockUploadSessionRegistrationInTx,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import type { WorkspaceFileUploadSource } from '@/lib/uploads/upload-session/workspace-file-provenance'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import {
  MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES,
  restoreSimPageSourceBuffer,
} from '@/lib/workspace-files/page-source-embed'

const logger = createLogger('ProjectFileUploads')

export interface CreateProjectFileUploadInput extends ProjectFileTarget {
  fileName: string
  contentType: string
  fileSize: number
  folderId?: string | null
  folderPath?: string
  exactName?: boolean
  localOrigin?: string
  /** Host-owned classification; public upload contracts never accept this field. */
  secretProvenance?: WorkspaceFileUploadSource
}

export interface ProjectFileUploadControlInput extends ProjectFileTarget {
  uploadId: string
  uploadToken: string
  partNumbers?: number[]
  localOrigin?: string
  /** Trusted evidence for a pending streamed upload; never request-body claims. */
  secretProvenance?: WorkspaceFileSecretProvenance
}

interface UploadArgs<I, P = undefined> {
  principal: Principal
  input: I
  context: ProjectFileAuthorizationContext
  request?: OrchestrationRequestContext
  tx: DbTransaction
  prepared?: P
}

async function mapUploadedFile(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  file: WorkspaceFileRow
) {
  const folders = file.folderId ? await listFileFolders(context.owner, { scope: 'all' }, tx) : []
  return {
    file: {
      ...mapFileRecord(file, context.owner, buildWorkspaceFileFolderPathMap(folders)),
      contentUpdatedAt: file.contentUpdatedAt,
    },
    capabilities: { canRead: true as const, canWrite: context.canWrite },
  }
}

async function loadRegisteredFile(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  fileId: string
) {
  const [row] = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.projectId, context.projectId),
        eq(workspaceFiles.context, 'project'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .for('share')
    .limit(1)
  return row ? mapUploadedFile(tx, context, row) : null
}

export const createProjectFileUploadSession = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.uploadCreate,
  async prepare({
    principal,
    input,
    context,
    request,
  }: Omit<UploadArgs<CreateProjectFileUploadInput>, 'tx'>) {
    const folder = await resolveFileFolderTarget(context.owner, input)
    const billing = await resolveProjectStorageBillingContext({
      projectId: context.projectId,
      ownerId: context.ownerUserId,
      organizationId: context.organizationId,
    })
    const quota = await checkStorageQuotaForBillingContext(billing, input.fileSize)
    if (!quota.allowed)
      throw new OrchestrationError('payload_too_large', quota.error ?? 'Storage limit exceeded')
    return createUploadSession({
      purpose: 'project_file',
      projectId: context.projectId,
      userId: requirePrincipalSubjectUserId(principal),
      principal,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSize: input.fileSize,
      localOrigin: input.localOrigin ?? (request ? requestOrigin(request) : undefined),
      secretProvenance: input.secretProvenance,
      metadata: { folderId: folder?.id ?? null, exactName: input.exactName === true },
    })
  },
  async execute({
    principal,
    context,
    tx,
    prepared,
  }: UploadArgs<CreateProjectFileUploadInput, CreatedUploadSession>) {
    if (!prepared) throw new Error('Upload session was not prepared')
    assertProjectFileUploadBinding(prepared, principal, context.projectId)
    await resolveFileFolderTarget(context.owner, { folderId: uploadFolderId(prepared) }, tx)
    return prepared
  },
  async onCommitFailure({ prepared }) {
    try {
      await abortUploadSession(prepared)
    } catch (error) {
      logger.warn('Upload cancellation will be retried by expiry cleanup', {
        uploadId: prepared.id,
        error,
      })
    } finally {
      await queueRetiredProjectUploadCleanup(prepared)
    }
  },
})

function uploadFolderId(session: UploadSessionRecord) {
  const id = session.metadata.folderId
  if (id !== null && typeof id !== 'string')
    throw new OrchestrationError('conflict', 'Upload folder binding is invalid')
  return id
}

async function loadControl(
  principal: Principal,
  operation: ProjectFileOperation,
  input: ProjectFileUploadControlInput
) {
  const authorize = await createProjectFileAuthorizer(principal, operation, input)
  return db.transaction(async (tx) => {
    const context = await authorize(tx)
    const session = await getOwnedUploadSession({
      uploadId: input.uploadId,
      uploadToken: input.uploadToken,
      purpose: 'project_file',
      principal,
      executor: tx,
    })
    assertProjectFileUploadBinding(session, principal, context.projectId)
    const file = session.completedFileId
      ? await loadRegisteredFile(tx, context, session.completedFileId)
      : null
    return { session, context, file }
  })
}

function controlUseCase<const O extends ProjectFileOperation, R>(
  operation: O,
  execute: (args: {
    principal: Principal
    input: ProjectFileUploadControlInput
    loaded: Awaited<ReturnType<typeof loadControl>>
    request?: OrchestrationRequestContext
  }) => Promise<R>
): AuthorizingUseCase<O, ProjectFileUploadControlInput, R> {
  return {
    operation,
    delegationAudience: operation.delegationAudience,
    async authorize({ principal, input }) {
      await loadControl(principal, operation, input)
    },
    async execute({ principal, input, request }) {
      const loaded = await loadControl(principal, operation, input)
      return runWithOutboundOrganization(loaded.context.organizationId, () =>
        execute({ principal, input, loaded, request })
      )
    },
  }
}

export const getProjectFileUploadSession = controlUseCase(
  projectFileOperations.uploadRead,
  async ({ loaded }) => ({ session: loaded.session, file: loaded.file?.file ?? null })
)

export const getProjectFileUploadPartUrls = controlUseCase(
  projectFileOperations.uploadParts,
  async ({ principal, input, loaded, request }) => {
    const localOrigin = input.localOrigin ?? (request ? requestOrigin(request) : undefined)
    if (!localOrigin)
      throw new OrchestrationError('validation', 'Upload part URLs require an origin')
    const parts = await createUploadPartUrls({
      session: loaded.session,
      partNumbers: input.partNumbers ?? [],
      localOrigin,
    })
    const current = await loadControl(principal, projectFileOperations.uploadParts, input)
    if (
      current.session.status !== 'uploading' ||
      current.session.completedFileId ||
      current.session.expiresAt.getTime() <= Date.now()
    )
      throw new OrchestrationError('conflict', 'Upload session no longer accepts bytes')
    return { parts }
  }
)

export const abortProjectFileUploadSession = controlUseCase(
  projectFileOperations.uploadCancel,
  async ({ loaded }) => abortUploadSession(loaded.session)
)

interface RegisterUploadInput extends ProjectFileTarget {
  session: UploadSessionRecord
}
interface PreparedUploadContent {
  staged: StagedFileContent
  restored: boolean
}
const uploadEffects = new WeakMap<
  object,
  { billing: ProjectStorageBillingContext; usage: number; cleanupIds: string[] }
>()

const registerProjectUpload = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.uploadComplete,
  invalidatesFileList: true,
  async prepare({
    principal,
    input,
    context,
  }: Omit<UploadArgs<RegisterUploadInput>, 'tx'>): Promise<PreparedUploadContent> {
    assertProjectFileUploadBinding(input.session, principal, context.projectId)
    const adopted = adoptVerifiedUploadSession(input.session, context.owner)
    if (
      adopted.name.toLowerCase().endsWith('.html') &&
      adopted.size > 0 &&
      adopted.size <= MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES
    ) {
      const bytes = await downloadFile({ key: adopted.key, context: 'project' })
      if (bytes.length !== adopted.size)
        throw new OrchestrationError('conflict', 'Upload bytes changed before registration')
      const restored = restoreSimPageSourceBuffer(adopted.name, bytes)
      if (restored)
        return {
          staged: await stageFileContent({
            owner: context.owner,
            userId: requirePrincipalSubjectUserId(principal),
            name: restored.name,
            contentType: SIM_PAGE_CONTENT_TYPE,
            content: restored.buffer,
          }),
          restored: true,
        }
    }
    return { staged: adopted, restored: false }
  },
  async execute({
    principal,
    input,
    context,
    tx,
    prepared,
  }: UploadArgs<RegisterUploadInput, PreparedUploadContent>) {
    if (!prepared) throw new Error('Upload bytes were not prepared')
    assertProjectFileUploadBinding(input.session, principal, context.projectId)
    const billing = await resolveProjectStorageBillingContext(
      {
        projectId: context.projectId,
        ownerId: context.ownerUserId,
        organizationId: context.organizationId,
      },
      tx
    )
    const accounting = await prepareProjectStorageMutationInTx(tx, billing)
    const registration = await lockUploadSessionRegistrationInTx(tx, input.session)
    const file = await commitFileCreateInTx(tx, {
      owner: context.owner,
      staged: prepared.staged,
      userId: requirePrincipalSubjectUserId(principal),
      folderId: uploadFolderId(input.session),
      exactName: input.session.metadata.exactName === true,
      secretProvenance: readProjectFileUploadProvenance(input.session.metadata, context.projectId),
    })
    const usage = await accounting.applyDelta(prepared.staged.size)
    await registration.registerFile(file.id)
    const cleanupIds = prepared.restored
      ? await enqueueWorkspaceFileStorageCleanups(tx, [input.session.finalKey], 'project', {
          availableAt: projectUploadCleanupAvailableAt(),
        })
      : []
    const result = await mapUploadedFile(tx, context, file)
    uploadEffects.set(result, { billing, usage, cleanupIds })
    return result
  },
  async onCommitFailure({ prepared }) {
    if (prepared.restored) await discardStagedFileContent(prepared.staged)
  },
  async afterSuccess({ result }) {
    const effects = uploadEffects.get(result)
    if (!effects) throw new Error('Committed upload effects are unavailable')
    uploadEffects.delete(result)
    await maybeNotifyStorageLimitForBillingContext(effects.billing, effects.usage)
    await processWorkspaceFileStorageCleanupsNow(effects.cleanupIds, {
      projectId: effects.billing.projectId,
      reason: 'restored editable page source',
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.FILE_UPLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Uploaded Project file "${result.file.name}"`,
    metadata: {
      projectId: input.projectId,
      fileSize: result.file.size,
      fileType: result.file.type,
    },
  }),
})

export const completeProjectFileUploadSession = controlUseCase(
  projectFileOperations.uploadComplete,
  async ({ principal, input, loaded }) => {
    if (loaded.session.status === 'completed' && !loaded.session.completedFileId)
      throw new OrchestrationError('conflict', 'Completed upload has no registered file')
    try {
      return await completeUploadSession({
        session: loaded.session,
        secretProvenance: input.secretProvenance,
        async loadCompleted() {
          const current = await loadControl(principal, projectFileOperations.uploadComplete, input)
          if (!current.file) throw new OrchestrationError('not_found', 'Uploaded file not found')
          return current.file
        },
        async finalize(session) {
          const value = await registerProjectUpload.execute({
            principal,
            input: { projectId: loaded.context.projectId, session },
          })
          return { value, completedFileId: value.file.id }
        },
      })
    } catch (error) {
      await queueRetiredProjectUploadCleanup(loaded.session)
      throw error
    }
  }
)
