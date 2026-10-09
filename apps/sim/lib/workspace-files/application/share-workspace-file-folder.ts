import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalExecutionActorUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { withFolderTreeLock } from '@/lib/folders/locks'
import { requireNonRootFolderPath } from '@/lib/folders/paths'
import { readActiveFolderAncestry } from '@/lib/public-shares/folder-scope'
import {
  getShareForResource,
  ShareValidationError,
  upsertResourceShare,
} from '@/lib/public-shares/share-manager'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { loadWorkspaceFileOperationContext } from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveSharePassword } from '@/lib/workspace-files/application/share-password'
import { validatePublicFileSharing } from '@/ee/access-control/utils/permission-check'

interface FolderShareTarget {
  workspaceId: string
  folderId?: string
  path?: string
}

interface UpdateWorkspaceFileFolderShareInput extends FolderShareTarget {
  isActive: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  token?: string
}

async function resolveWorkspace({ input }: { input: FolderShareTarget }) {
  const context = await loadWorkspaceFileOperationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveTarget(input: FolderShareTarget, tx: DbOrTx) {
  if ((input.folderId === undefined) === (input.path === undefined)) {
    throw new OrchestrationError('validation', 'Specify a folder ID or path')
  }
  let folderId = input.folderId
  if (input.path !== undefined) {
    let parentId: string | null = null
    for (const segment of requireNonRootFolderPath(input.path)) {
      const [match] = await tx
        .select({ id: folder.id })
        .from(folder)
        .where(
          and(
            eq(folder.workspaceId, input.workspaceId),
            eq(folder.resourceType, 'file'),
            eq(folder.name, segment),
            parentId === null ? isNull(folder.parentId) : eq(folder.parentId, parentId),
            isNull(folder.deletedAt)
          )
        )
        .limit(1)
      if (!match) throw new OrchestrationError('not_found', 'Folder not found')
      parentId = match.id
    }
    folderId = parentId ?? undefined
  }
  const [target] = folderId
    ? await tx
        .select()
        .from(folder)
        .where(
          and(
            eq(folder.id, folderId),
            eq(folder.workspaceId, input.workspaceId),
            eq(folder.resourceType, 'file'),
            isNull(folder.deletedAt)
          )
        )
        .limit(1)
    : []
  if (!target || !(await readActiveFolderAncestry(input.workspaceId, target.id, tx))) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }
  return target
}

/** Reads sharing settings only after current workspace access has been authorized. */
export const getWorkspaceFileFolderShare = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readFolderShare,
  resolveContext: resolveWorkspace,
  async execute({ input }): Promise<{ share: ShareRecord | null }> {
    return withFolderTreeLock(input.workspaceId, 'file', async (tx) => {
      const target = await resolveTarget(input, tx)
      return { share: await getShareForResource('folder', target.id, tx) }
    })
  },
})

/** Manages one live folder capability under the same policy as individual file sharing. */
export const updateWorkspaceFileFolderShare = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateFolderShare,
  resolveContext: ({ input }: { input: UpdateWorkspaceFileFolderShareInput }) =>
    resolveWorkspace({ input }),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalExecutionActorUserId(principal)
    if (!userId)
      throw new OrchestrationError(
        'forbidden',
        'Folder sharing requires a user subject or execution actor'
      )
    const preparedTarget = await resolveTarget(input, db)
    const preparedShare = await getShareForResource('folder', preparedTarget.id)
    const preparedAuthType = input.authType ?? preparedShare?.authType ?? 'public'
    if (input.isActive)
      await validatePublicFileSharing(userId, context.workspaceId, preparedAuthType)
    const password =
      input.isActive && preparedAuthType === 'password'
        ? await resolveSharePassword(principal, context.workspaceId, input.password)
        : input.password
    return withFolderTreeLock(context.workspaceId, 'file', async (tx) => {
      const target = await resolveTarget(input, tx)
      const existing = await getShareForResource('folder', target.id, tx)
      const effectiveAuthType = input.authType ?? existing?.authType ?? 'public'
      if (target.id !== preparedTarget.id || effectiveAuthType !== preparedAuthType)
        throw new OrchestrationError(
          'conflict',
          'The folder or sharing settings changed. Please try again.'
        )
      try {
        const share = await upsertResourceShare(
          {
            workspaceId: context.workspaceId,
            resourceType: 'folder',
            resourceId: target.id,
            userId,
            isActive: input.isActive,
            authType: input.authType,
            password,
            allowedEmails: input.allowedEmails,
            token: input.token,
          },
          tx
        )
        return { share, folder: { id: target.id, name: target.name } }
      } catch (error) {
        if (error instanceof ShareValidationError)
          throw new OrchestrationError('validation', error.message)
        throw error
      }
    })
  },
  projectAudit: ({ input, result }) => ({
    action: input.isActive ? AuditAction.FOLDER_SHARED : AuditAction.FOLDER_SHARE_DISABLED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.folder.id,
    resourceName: result.folder.name,
    description: `${input.isActive ? 'Enabled' : 'Disabled'} public share for "${result.folder.name}"`,
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
