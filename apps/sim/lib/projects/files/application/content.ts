import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import type { PreparedCollabDocState } from '@/lib/collab-doc/collab-state'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  finishProjectFileWrite,
  mapProjectFileResult,
  prepareProjectFileAccounting,
  recordProjectFileWriteEffects,
} from '@/lib/projects/files/application/write-effects'
import { enqueueWorkspaceFileLiveDocReconciliation } from '@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox'
import {
  ContentVersionConflictError,
  commitFileContentInTx,
  commitFileCreateInTx,
  discardStagedFileContent,
  type StagedFileContent,
  stageFileContent,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'
import {
  hasWorkspaceFileDeliveryObserver,
  reportWorkspaceFileDelivery,
} from '@/lib/workspace-files/application/file-delivery-observer'
import { parseWorkspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { resolveWorkspaceFileVersionWrite } from '@/lib/workspace-files/application/file-version-write'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { restoreSimPageSourceBuffer } from '@/lib/workspace-files/page-source-embed'

interface ContentUseCaseArgs<I, P = undefined> {
  principal: Principal
  input: I
  context: ProjectFileAuthorizationContext
  tx: DbTransaction
  prepared?: P
}

export interface CreateProjectFileInput extends ProjectFileTarget {
  name: string
  contentType: string
  content: string
  encoding: 'utf-8' | 'base64'
  folderId?: string | null
  folderPath?: string
  exactName?: boolean
  secretProvenance?: WorkspaceFileSecretProvenance
}

export interface UpdateProjectFileContentInput extends ProjectFileTarget {
  fileId: string
  /** Private realtime state committed under the same file revision fence; absent from HTTP contracts. */
  collabDocState?: PreparedCollabDocState
  content: string
  encoding: 'utf-8' | 'base64'
  contentType?: string
  expectedRevision?: string
  expectedUpdatedAt?: Date
  provenanceMode?: 'replace_empty' | 'preserve'
  secretProvenance?: WorkspaceFileSecretProvenance
}

export interface ReadProjectFileContentInput extends ProjectFileTarget {
  fileId: string
  maxBytes?: number
  includeSecretProvenance?: boolean
}

function requireFile(context: ProjectFileAuthorizationContext) {
  if (!context.file) throw new OrchestrationError('not_found', 'File not found')
  return context.file
}

function decodeContent(input: { content: string; encoding: 'utf-8' | 'base64' }) {
  const content = Buffer.from(input.content, input.encoding)
  if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES)
    throw new OrchestrationError(
      'payload_too_large',
      'File content exceeds the inline upload limit'
    )
  return content
}

function replacementProvenance(
  principal: Principal,
  provenance?: WorkspaceFileSecretProvenance
): WorkspaceFileSecretProvenance {
  return (
    provenance ??
    (principal.kind === 'resource_delegated'
      ? { status: 'unknown' }
      : EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE)
  )
}

export const createProjectFile = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.create,
  invalidatesFileList: true,
  async prepare({
    principal,
    input,
    context,
  }: Omit<ContentUseCaseArgs<CreateProjectFileInput>, 'tx'>) {
    const content = decodeContent(input)
    const restored = restoreSimPageSourceBuffer(input.name, content)
    return stageFileContent({
      owner: context.owner,
      userId: requirePrincipalSubjectUserId(principal),
      name: restored?.name ?? input.name,
      contentType: restored ? SIM_PAGE_CONTENT_TYPE : input.contentType,
      content: restored?.buffer ?? content,
    })
  },
  async execute({
    principal,
    input,
    context,
    tx,
    prepared,
  }: ContentUseCaseArgs<CreateProjectFileInput, StagedFileContent>) {
    if (!prepared) throw new Error('File content was not staged')
    const accounting = await prepareProjectFileAccounting(tx, context)
    const file = await commitFileCreateInTx(tx, {
      owner: context.owner,
      staged: prepared,
      userId: requirePrincipalSubjectUserId(principal),
      folderId: input.folderId,
      folderPath: input.folderPath,
      exactName: input.exactName,
      secretProvenance: replacementProvenance(principal, input.secretProvenance),
    })
    const usage = await accounting.mutation.applyDelta(prepared.size)
    const result = await mapProjectFileResult(tx, context, file)
    recordProjectFileWriteEffects(result, {
      billing: accounting.billing,
      usage,
      delta: prepared.size,
      cleanupIds: [],
    })
    return result
  },
  onCommitFailure: ({ prepared }) => discardStagedFileContent(prepared),
  afterSuccess: ({ result }) => finishProjectFileWrite(result),
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

export const updateProjectFileContent = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.updateContent,
  invalidatesFileList: ({ context, result }) => context.file?.key !== result.file.key,
  async prepare({
    principal,
    input,
    context,
  }: Omit<ContentUseCaseArgs<UpdateProjectFileContentInput>, 'tx'>) {
    const file = requireFile(context)
    return stageFileContent({
      owner: context.owner,
      userId: requirePrincipalSubjectUserId(principal),
      name: file.originalName,
      contentType: input.contentType ?? file.contentType,
      content: decodeContent(input),
    })
  },
  async execute({
    principal,
    input,
    context,
    tx,
    prepared,
  }: ContentUseCaseArgs<UpdateProjectFileContentInput, StagedFileContent>) {
    if (!prepared) throw new Error('File content was not staged')
    const accounting = await prepareProjectFileAccounting(tx, context)
    let committed
    try {
      committed = await commitFileContentInTx(tx, {
        owner: context.owner,
        fileId: input.fileId,
        staged: prepared,
        version: resolveWorkspaceFileVersionWrite(principal),
        collabDocState: input.collabDocState,
        expectedUpdatedAt: input.expectedRevision
          ? parseWorkspaceFileRevision(input.expectedRevision, input.fileId)
          : input.expectedUpdatedAt,
        secretProvenancePolicy:
          input.provenanceMode === 'preserve'
            ? { mode: 'preserve' }
            : {
                mode: 'replace',
                provenance: replacementProvenance(principal, input.secretProvenance),
              },
      })
    } catch (error) {
      if (error instanceof ContentVersionConflictError)
        throw new OrchestrationError('conflict', error.message)
      throw error
    }
    const liveDocEventId =
      !input.collabDocState &&
      (isMarkdownFile({
        name: committed.previous.originalName,
        type: committed.previous.contentType,
      }) ||
        isMarkdownFile({ name: committed.file.originalName, type: committed.file.contentType }))
        ? await enqueueWorkspaceFileLiveDocReconciliation(tx, {
            owner: context.owner,
            fileId: committed.file.id,
            version: committed.file.contentUpdatedAt.getTime(),
          })
        : undefined
    const usage = await accounting.mutation.applyDelta(committed.sizeDiff)
    const mapped = await mapProjectFileResult(tx, context, committed.file)
    const result = { ...mapped, file: { ...mapped.file, currentVersion: committed.currentVersion } }
    recordProjectFileWriteEffects(result, {
      billing: accounting.billing,
      usage,
      delta: committed.sizeDiff,
      cleanupIds: committed.storageCleanupEventIds,
      liveDocEventId,
    })
    return result
  },
  onCommitFailure: ({ prepared }) => discardStagedFileContent(prepared),
  afterSuccess: ({ result }) => finishProjectFileWrite(result),
  projectAudit: ({ input, result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Updated Project file "${result.file.name}"`,
    metadata: { projectId: input.projectId, contentSize: result.file.size },
  }),
})

interface PreparedFileRead {
  key: string
  revision: Date
  content: Buffer
}

export const readProjectFileContent = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readContent,
  async prepare({
    input,
    context,
  }: Omit<ContentUseCaseArgs<ReadProjectFileContentInput>, 'tx'>): Promise<PreparedFileRead> {
    const file = requireFile(context)
    const content = await downloadFile({
      key: file.key,
      context: 'project',
      maxBytes: input.maxBytes ?? MAX_BUFFERED_TRANSFER_BYTES,
    })
    return { key: file.key, revision: file.contentUpdatedAt, content }
  },
  async execute({
    input,
    context,
    tx,
    prepared,
  }: ContentUseCaseArgs<ReadProjectFileContentInput, PreparedFileRead>) {
    const file = requireFile(context)
    if (
      !prepared ||
      file.key !== prepared.key ||
      file.contentUpdatedAt.getTime() !== prepared.revision.getTime()
    )
      throw new OrchestrationError('conflict', 'File changed while its content was being read')
    const provenance =
      input.includeSecretProvenance || hasWorkspaceFileDeliveryObserver()
        ? ((await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [file])).get(file.id) ?? {
            status: 'unknown' as const,
          })
        : undefined
    return {
      ...(await mapProjectFileResult(tx, context, file)),
      content: prepared.content,
      ...(provenance ? { secretProvenance: provenance } : {}),
    }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
})
