import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FileConflictError,
  loadActiveWorkspaceContext,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration'

const logger = createLogger('CreateWorkspaceFile')

export interface CreateWorkspaceFileInput {
  workspaceId: string
  name: string
  contentType: string
  content: string
  encoding: 'utf-8' | 'base64'
  folderId?: string | null
  folderPath?: string
  exactName: boolean
  secretProvenance?: WorkspaceFileSecretProvenance
}

export interface CreateWorkspaceFileResult {
  file: WorkspaceFileRecord
}

export interface CreateWorkspaceFileBufferInput
  extends Omit<CreateWorkspaceFileInput, 'content' | 'encoding'> {
  content: Buffer
  notifyWorkspaceChange?: boolean
}

async function resolveCreateWorkspaceFileContext(workspaceId: string) {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return workspace
}

async function createAuthorizedWorkspaceFile({
  principal,
  input,
  content,
  workspace,
}: {
  principal: Principal
  input: Omit<CreateWorkspaceFileBufferInput, 'content'>
  content: Buffer
  workspace: Awaited<ReturnType<typeof resolveCreateWorkspaceFileContext>>
}): Promise<CreateWorkspaceFileResult> {
  const attribution = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: workspace.billedAccountUserId,
  })
  let file: WorkspaceFileRecord
  try {
    file = await uploadWorkspaceFile(
      workspace.workspaceId,
      attribution.attributedUserId,
      content,
      input.name,
      input.contentType,
      {
        folderId: input.folderId,
        folderPath: input.folderPath,
        exactName: input.exactName,
        secretProvenance: input.secretProvenance ?? EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
        notifyWorkspaceChange: input.notifyWorkspaceChange,
      }
    )
  } catch (error) {
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      throw new OrchestrationError('conflict', 'File already exists')
    }
    throw error
  }

  logger.info('Created workspace file', {
    workspaceId: workspace.workspaceId,
    fileId: file.id,
    folderId: file.folderId,
    size: file.size,
    principalKind: principal.kind,
  })
  return { file }
}

function projectCreateWorkspaceFileAudit(result: CreateWorkspaceFileResult) {
  return {
    action: AuditAction.FILE_UPLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Uploaded file "${result.file.name}"`,
    metadata: {
      fileSize: result.file.size,
      fileType: result.file.type,
    },
  } as const
}

const admitCreateWorkspaceFileUseCase = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.create,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveCreateWorkspaceFileContext(input.workspaceId),
  async execute() {},
})

export async function admitCreateWorkspaceFile(
  principal: Principal,
  workspaceId: string
): Promise<void> {
  await admitCreateWorkspaceFileUseCase.execute({ principal, input: { workspaceId } })
}

export const createWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.create,
  resolveContext: ({ input }: { input: CreateWorkspaceFileInput }) =>
    resolveCreateWorkspaceFileContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<CreateWorkspaceFileResult> {
    const content = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf-8')
    if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
      throw new OrchestrationError(
        'payload_too_large',
        `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`
      )
    }
    return createAuthorizedWorkspaceFile({ principal, input, content, workspace: context })
  },
  projectAudit: ({ result }) => projectCreateWorkspaceFileAudit(result),
})

export const createWorkspaceFileFromBuffer = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.create,
  resolveContext: ({ input }: { input: CreateWorkspaceFileBufferInput }) =>
    resolveCreateWorkspaceFileContext(input.workspaceId),
  execute: ({ principal, input, context }) =>
    createAuthorizedWorkspaceFile({
      principal,
      input,
      content: input.content,
      workspace: context,
    }),
  projectAudit: ({ result }) => projectCreateWorkspaceFileAudit(result),
})
