import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workspaceAccountsSettingsDelegationPolicy } from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupSettingsAvailable,
  resolveCredentialGroupSettingsContext,
  resolveCredentialGroupWorkspaceContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  validateCredentialGroupEnrollmentPage,
  validateUpdateCredentialGroupInput,
} from '@/lib/credential-groups/application/validation'
import {
  CredentialGroupEnrollmentError,
  listCredentialGroupEnrollments,
} from '@/lib/credential-groups/enrollments'
import { listConfiguredCredentialGroupProviders } from '@/lib/credential-groups/provider-availability'
import {
  ensureWorkspaceAccountsGroup,
  getCredentialGroup,
  getWorkspaceAccountsGroup,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'
import type { UpdateCredentialGroupInput } from '@/lib/credential-groups/types'

export interface WorkspaceAccountsSettingsInput {
  workspaceId: string
}

export const getWorkspaceAccountsSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.workspaceSettings,
  resolveContext: ({ input }: { input: WorkspaceAccountsSettingsInput }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: workspaceAccountsSettingsDelegationPolicy },
  async execute({ context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    return {
      credentialGroup: await getWorkspaceAccountsGroup(context.workspaceId),
      availableProviders: listConfiguredCredentialGroupProviders(),
    }
  },
})

export const ensureWorkspaceAccounts = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.ensureWorkspaceAccounts,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    const { created, ...credentialGroup } = await ensureWorkspaceAccountsGroup(
      context.workspaceId,
      principal.userId
    )
    return { credentialGroup, created }
  },
  projectAudit: ({ result }) =>
    result.created
      ? {
          action: AuditAction.CREDENTIAL_GROUP_UPDATED,
          resourceType: AuditResourceType.CREDENTIAL_GROUP,
          resourceId: result.credentialGroup.id,
          resourceName: result.credentialGroup.name,
          description: 'Set up connected accounts',
        }
      : [],
})

interface CredentialGroupSettingsTargetInput {
  assertedWorkspaceId: string
  credentialGroupId: string
}

export interface GetCredentialGroupSettingsInput extends CredentialGroupSettingsTargetInput {
  limit: number
  cursor?: string
}

export const getCredentialGroupSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.readSettings,
  resolveContext: ({ input }: { input: GetCredentialGroupSettingsInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    validateCredentialGroupEnrollmentPage(input.limit)
    const credentialGroup = await getCredentialGroup(context.workspaceId, context.credentialGroupId)
    if (!credentialGroup) throw new OrchestrationError('not_found', 'Credential group not found')
    try {
      const enrollmentPage = await listCredentialGroupEnrollments(
        context.workspaceId,
        context.credentialGroupId,
        input.limit,
        input.cursor,
        { statuses: ['invited', 'in_progress', 'completed', 'delivery_failed'] }
      )
      return { credentialGroup, ...enrollmentPage }
    } catch (error) {
      if (error instanceof CredentialGroupEnrollmentError && error.status === 404) {
        throw new OrchestrationError('not_found', error.message)
      }
      throw error
    }
  },
})

export interface UpdateCredentialGroupSettingsInput extends CredentialGroupSettingsTargetInput {
  update: UpdateCredentialGroupInput
}

export const updateCredentialGroupSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.update,
  resolveContext: ({ input }: { input: UpdateCredentialGroupSettingsInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    const credentialGroup = await updateCredentialGroup(
      context.workspaceId,
      context.credentialGroupId,
      validateUpdateCredentialGroupInput(input.update)
    )
    if (!credentialGroup) {
      throw new OrchestrationError('not_found', 'Connected accounts not found')
    }
    return { credentialGroup }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: result.credentialGroup.id,
    resourceName: result.credentialGroup.name,
    description: 'Updated connected accounts',
  }),
})
