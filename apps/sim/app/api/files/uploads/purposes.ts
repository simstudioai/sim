import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { CreateInternalFileUploadBody } from '@/lib/api/contracts/upload-sessions'
import { assertWorkspaceFileFolderTarget } from '@/lib/uploads/contexts/workspace'
import {
  createUploadSession,
  UploadSessionError,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'
import { validateAttachmentFileType } from '@/lib/uploads/utils/validation'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export type InternalUploadPurpose = CreateInternalFileUploadBody['purpose']

const INTERNAL_UPLOAD_PURPOSES = new Set<InternalUploadPurpose>([
  'workspace_file',
  'profile_picture',
  'workspace_logo',
  'mothership_attachment',
  'execution_attachment',
])

export async function createPurposeUploadSession(
  userId: string,
  body: CreateInternalFileUploadBody,
  localOrigin: string
) {
  validatePurposeFile(body)

  switch (body.purpose) {
    case 'workspace_file': {
      await requireWorkspacePermission(userId, body.workspaceId, 'write')
      const folderId = await assertWorkspaceFileFolderTarget(body.workspaceId, body.folderId)
      return createUploadSession({
        purpose: body.purpose,
        workspaceId: body.workspaceId,
        userId,
        fileName: body.name,
        contentType: body.contentType,
        fileSize: body.size,
        metadata: { folderId },
        localOrigin,
      })
    }
    case 'profile_picture':
      return createUploadSession({
        purpose: body.purpose,
        userId,
        fileName: body.name,
        contentType: body.contentType,
        fileSize: body.size,
        localOrigin,
      })
    case 'workspace_logo':
      await requireWorkspacePermission(userId, body.workspaceId, 'admin')
      return createUploadSession({
        purpose: body.purpose,
        workspaceId: body.workspaceId,
        userId,
        fileName: body.name,
        contentType: body.contentType,
        fileSize: body.size,
        localOrigin,
      })
    case 'mothership_attachment':
      await requireWorkspacePermission(userId, body.workspaceId, 'write')
      return createUploadSession({
        purpose: body.purpose,
        workspaceId: body.workspaceId,
        userId,
        fileName: body.name,
        contentType: body.contentType,
        fileSize: body.size,
        localOrigin,
      })
    case 'execution_attachment':
      await requireExecutionPermission(userId, body.workflowId, body.workspaceId)
      return createUploadSession({
        purpose: body.purpose,
        workspaceId: body.workspaceId,
        workflowId: body.workflowId,
        executionId: body.executionId,
        userId,
        fileName: body.name,
        contentType: body.contentType,
        fileSize: body.size,
        localOrigin,
      })
  }
}

/**
 * Rechecks current domain authorization for every control-plane session request.
 */
export async function reauthorizeUploadPurpose(
  userId: string,
  session: UploadSessionRecord
): Promise<void> {
  if (session.userId !== userId || !isInternalUploadPurpose(session.purpose)) {
    throw new UploadSessionError('not_found', 'Upload session not found')
  }

  switch (session.purpose) {
    case 'workspace_file':
    case 'mothership_attachment':
      await requireWorkspacePermission(userId, requireSessionScope(session.workspaceId), 'write')
      return
    case 'profile_picture':
      return
    case 'workspace_logo':
      await requireWorkspacePermission(userId, requireSessionScope(session.workspaceId), 'admin')
      return
    case 'execution_attachment':
      await requireExecutionPermission(
        userId,
        requireSessionScope(session.workflowId),
        requireSessionScope(session.workspaceId)
      )
      return
  }
}

export function isInternalUploadPurpose(purpose: string): purpose is InternalUploadPurpose {
  return INTERNAL_UPLOAD_PURPOSES.has(purpose as InternalUploadPurpose)
}

function validatePurposeFile(body: CreateInternalFileUploadBody): void {
  if (body.purpose === 'profile_picture' || body.purpose === 'workspace_logo') {
    if (!isImageFileType(body.contentType)) {
      throw new UploadSessionError(
        'validation',
        `Only image files are allowed for ${body.purpose.replace('_', ' ')} uploads`
      )
    }
    return
  }

  if (body.purpose === 'mothership_attachment' || body.purpose === 'execution_attachment') {
    const validation = validateAttachmentFileType(body.name, {
      allowArchives: body.purpose === 'mothership_attachment',
    })
    if (validation) throw new UploadSessionError('validation', validation.message)
  }
}

async function requireWorkspacePermission(
  userId: string,
  workspaceId: string,
  action: 'write' | 'admin'
): Promise<void> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  const allowed =
    action === 'admin' ? permission === 'admin' : permission === 'write' || permission === 'admin'
  if (!allowed) {
    throw new UploadSessionError(
      'forbidden',
      action === 'admin' ? 'Admin access required' : 'Write or Admin access required'
    )
  }
}

async function requireExecutionPermission(
  userId: string,
  workflowId: string,
  signedWorkspaceId: string
): Promise<void> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'write',
  })
  if (!authorization.workflow) {
    throw new UploadSessionError('not_found', 'Workflow not found')
  }
  if (!authorization.allowed) {
    throw new UploadSessionError('forbidden', authorization.message ?? 'Workflow access denied')
  }
  if (authorization.workflow.workspaceId !== signedWorkspaceId) {
    throw new UploadSessionError('forbidden', 'Workflow does not belong to the upload workspace')
  }
}

function requireSessionScope(value: string | null, label = 'scope'): string {
  if (!value) {
    throw new UploadSessionError('forbidden', `Upload session is missing its ${label}`)
  }
  return value
}
