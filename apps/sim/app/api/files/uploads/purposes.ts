import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import type { CreateInternalFileUploadBody } from '@/lib/api/contracts/upload-sessions'
import type { WorkspaceOperation } from '@/lib/core/application'
import { assertWorkspaceFileFolderTarget } from '@/lib/uploads/contexts/workspace'
import {
  assertUploadSessionAuthBinding,
  createUploadSession,
  UploadSessionError,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'
import { validateAttachmentFileType } from '@/lib/uploads/utils/validation'
import { authorizeWorkspaceFileAccess } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'
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
  principal: Principal,
  body: CreateInternalFileUploadBody,
  localOrigin: string
) {
  const userId = await principalUserId(
    principal,
    'workspaceId' in body ? body.workspaceId : undefined
  )
  validatePurposeFile(body)

  switch (body.purpose) {
    case 'workspace_file': {
      const context = await loadWorkspaceAuthorizationContext(body.workspaceId)
      if (!context) throw new UploadSessionError('not_found', 'Workspace not found')
      await authorizeWorkspaceFileAccess(principal, fileOperations.uploadCreate, context)
      const folderId = await assertWorkspaceFileFolderTarget(body.workspaceId, body.folderId)
      return createUploadSession({
        purpose: body.purpose,
        workspaceId: body.workspaceId,
        userId,
        fileName: body.name,
        contentType: body.contentType,
        fileSize: body.size,
        metadata: { folderId },
        principal,
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

/**
 * Re-authorizes a workspace-file control leg against the current principal and
 * current workspace policy. Session metadata is only accepted after the
 * immutable, server-authored credential binding matches.
 */
export async function reauthorizeWorkspaceUploadPurpose(
  principal: Principal,
  session: UploadSessionRecord,
  operation: WorkspaceOperation = fileOperations.uploadComplete
): Promise<void> {
  if (session.purpose !== 'workspace_file' || !session.workspaceId) {
    throw new UploadSessionError('not_found', 'Upload session not found')
  }
  assertUploadSessionAuthBinding(session, principal)
  const context = await loadWorkspaceAuthorizationContext(session.workspaceId)
  if (!context) throw new UploadSessionError('not_found', 'Upload session not found')
  await authorizeWorkspaceFileAccess(principal, operation, {
    workspaceId: context.workspaceId,
    workspaceOrganizationId: context.workspaceOrganizationId,
    allowPersonalApiKeys: context.allowPersonalApiKeys,
  })
}

export function isInternalUploadPurpose(purpose: string): purpose is InternalUploadPurpose {
  return INTERNAL_UPLOAD_PURPOSES.has(purpose as InternalUploadPurpose)
}

/** Resolves the current billing owner only for legacy upload attribution fields. */
export async function resolveUploadAttributionUserId(
  principal: Principal,
  workspaceId: string
): Promise<string> {
  return principalUserId(principal, workspaceId)
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

async function principalUserId(principal: Principal, workspaceId?: string): Promise<string> {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
    case 'oauth_access_token':
      return principal.userId
    case 'workspace_api_key':
      if (!workspaceId || principal.workspaceId !== workspaceId) {
        throw new UploadSessionError('forbidden', 'Workspace API key cannot access this workspace')
      }
      {
        const context = await loadWorkspaceAuthorizationContext(workspaceId)
        if (!context?.billedAccountUserId) {
          throw new Error('Workspace upload attribution requires a billing owner')
        }
        return context.billedAccountUserId
      }
    case 'delegated':
      throw new UploadSessionError('forbidden', 'Delegated principals cannot create uploads')
    case 'system':
      throw new UploadSessionError('forbidden', 'System principals cannot create uploads')
    case 'organization_delegated':
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
  }
}

async function loadWorkspaceAuthorizationContext(workspaceId: string): Promise<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
} | null> {
  const [row] = await db
    .select({
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  return row ?? null
}
