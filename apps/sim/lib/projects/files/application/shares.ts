import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { CAPABILITY_RULES, refuseCapability } from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  type FileShareUpdate,
  getOwnedFileShare,
  ShareValidationError,
  upsertOwnedFileShare,
} from '@/lib/public-shares/share-manager'

interface ShareTarget extends ProjectFileTarget {
  fileId: string
}
interface UpdateShareInput extends ShareTarget, Omit<FileShareUpdate, 'fileId' | 'userId'> {}

interface ProjectFileSharePolicy {
  canPublish: boolean
  allowedAuthTypes: NonNullable<FileShareUpdate['authType']>[]
}

async function resolveProjectFileSharePolicy(
  principal: Principal,
  context: ProjectFileAuthorizationContext,
  tx: DbTransaction
): Promise<ProjectFileSharePolicy> {
  const userId = requirePrincipalSubjectUserId(principal)
  const configs: Awaited<ReturnType<typeof resolvePermissionGroupConfig>>[] = []
  for (const workspaceId of context.visibleWorkspaceIds) {
    configs.push(
      await resolvePermissionGroupConfig(userId, workspaceId, context.organizationId, tx)
    )
  }
  if (configs.length === 0 && context.organizationId)
    configs.push(await getUserPermissionConfigForOrganization(context.organizationId, tx))
  const modes = ['public', 'password', 'email', 'sso'] as const
  return {
    canPublish: configs.every(
      (config) => !config || !CAPABILITY_RULES['file_share.publish'].deniedBy(config)
    ),
    allowedAuthTypes: modes.filter((mode) =>
      configs.every(
        (config) => !config || !CAPABILITY_RULES['file_share.auth_mode'].deniedBy(config, mode)
      )
    ),
  }
}

export const getProjectFileShare = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.readShare,
  ShareTarget,
  {
    share: Awaited<ReturnType<typeof getOwnedFileShare>>
    policy: ProjectFileSharePolicy
    capabilities: { canRead: true; canWrite: boolean }
  }
>({
  operation: projectFileOperations.readShare,
  async execute({
    principal,
    input,
    context,
    tx,
  }: {
    principal: Principal
    input: ShareTarget
    context: ProjectFileAuthorizationContext
    tx: DbTransaction
  }) {
    return {
      share: await getOwnedFileShare(tx, context.owner, input.fileId),
      policy: await resolveProjectFileSharePolicy(principal, context, tx),
      capabilities: { canRead: true, canWrite: context.canWrite },
    }
  },
})

export const updateProjectFileShare = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.updateShare,
  UpdateShareInput,
  { share: Awaited<ReturnType<typeof upsertOwnedFileShare>> }
>({
  operation: projectFileOperations.updateShare,
  invalidatesFileList: ({ result }) => result.share !== null,
  async execute({
    principal,
    input,
    context,
    tx,
  }: {
    principal: Principal
    input: UpdateShareInput
    context: ProjectFileAuthorizationContext
    tx: DbTransaction
  }) {
    const existing = await getOwnedFileShare(tx, context.owner, input.fileId)
    const effectiveAuthType = input.authType ?? existing?.authType ?? 'public'
    if (input.isActive) {
      const policy = await resolveProjectFileSharePolicy(principal, context, tx)
      // permission-group-enforced: file_share.publish — the read projection and write gate share every applicable environment policy.
      if (!policy.canPublish) refuseCapability('file_share.publish')
      // permission-group-enforced: file_share.auth_mode — only the intersection of applicable modes may be published.
      if (!policy.allowedAuthTypes.includes(effectiveAuthType))
        refuseCapability('file_share.auth_mode')
    }

    try {
      return {
        share: await upsertOwnedFileShare(tx, context.owner, {
          ...input,
          userId: requirePrincipalSubjectUserId(principal),
        }),
      }
    } catch (error) {
      if (error instanceof ShareValidationError)
        throw new OrchestrationError('validation', error.message)
      throw error
    }
  },
  projectAudit: ({ input, context }) => ({
    action: input.isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
    resourceType: AuditResourceType.FILE,
    resourceId: input.fileId,
    resourceName: context.file?.originalName,
    description: `${input.isActive ? 'Enabled' : 'Disabled'} public share for Project file`,
    metadata: { projectId: context.projectId },
  }),
})
