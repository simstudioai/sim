import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FileConflictError,
  loadActiveWorkspaceContext,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { authorizeWorkspaceOperation } from '@/lib/workspace-files/application/authorization'
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
}

interface CreateWorkspaceFileArguments {
  principal: Principal
  input: CreateWorkspaceFileInput
  request?: OrchestrationRequestContext
}

interface CreateWorkspaceFileBufferArguments {
  principal: Principal
  input: CreateWorkspaceFileBufferInput
  request?: OrchestrationRequestContext
}

async function requireCreateWorkspaceFileAccess(principal: Principal, workspaceId: string) {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  await authorizeWorkspaceOperation(principal, fileOperations.create, workspace)
  return workspace
}

async function executeCreateWorkspaceFile({
  principal,
  input,
  request,
}: CreateWorkspaceFileArguments): Promise<CreateWorkspaceFileResult> {
  const workspace = await requireCreateWorkspaceFileAccess(principal, input.workspaceId)

  const content = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf-8')
  if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`
    )
  }

  return createAuthorizedWorkspaceFile({ principal, input, content, request, workspace })
}

async function executeCreateWorkspaceFileBuffer({
  principal,
  input,
  request,
}: CreateWorkspaceFileBufferArguments): Promise<CreateWorkspaceFileResult> {
  const workspace = await requireCreateWorkspaceFileAccess(principal, input.workspaceId)
  return createAuthorizedWorkspaceFile({
    principal,
    input,
    content: input.content,
    request,
    workspace,
  })
}

async function createAuthorizedWorkspaceFile({
  principal,
  input,
  content,
  request,
  workspace,
}: {
  principal: Principal
  input: Omit<CreateWorkspaceFileInput, 'content' | 'encoding'>
  content: Buffer
  request?: OrchestrationRequestContext
  workspace: Awaited<ReturnType<typeof requireCreateWorkspaceFileAccess>>
}): Promise<CreateWorkspaceFileResult> {
  const attribution = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: workspace.billedAccountUserId,
  })
  const auditAttribution = resolvePrincipalAuditAttribution(principal)

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
  recordAudit({
    workspaceId: workspace.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_UPLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Uploaded file "${file.name}"`,
    metadata: {
      operation: fileOperations.create.id,
      actor: auditAttribution.actor,
      fileSize: file.size,
      fileType: file.type,
    },
    request,
  })

  return { file }
}

export const createWorkspaceFile = {
  operation: fileOperations.create,
  admit: requireCreateWorkspaceFileAccess,
  execute: executeCreateWorkspaceFile,
} as const

export const createWorkspaceFileFromBuffer = {
  operation: fileOperations.create,
  execute: executeCreateWorkspaceFileBuffer,
} as const
