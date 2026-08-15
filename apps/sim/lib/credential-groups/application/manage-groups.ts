import { AuditAction, AuditResourceType } from '@sim/audit'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  requireCredentialGroupSettingsAvailable,
  resolveCredentialGroupSettingsContext,
  resolveCredentialGroupWorkspaceContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  validateCreateCredentialGroupInput,
  validateCredentialGroupEnrollmentPage,
  validateUpdateCredentialGroupInput,
} from '@/lib/credential-groups/application/validation'
import {
  CredentialGroupEnrollmentError,
  listCredentialGroupEnrollments,
} from '@/lib/credential-groups/enrollments'
import {
  createCredentialGroup,
  deleteCredentialGroup,
  getCredentialGroup,
  listCredentialGroups,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'
import type {
  CreateCredentialGroupInput,
  UpdateCredentialGroupInput,
} from '@/lib/credential-groups/types'

function throwCredentialGroupConflict(error: unknown): never {
  if (getPostgresErrorCode(error) === '23505') {
    throw new OrchestrationError('conflict', 'A credential group with this name already exists')
  }
  throw error
}

export interface ListCredentialGroupSettingsInput {
  workspaceId: string
}

export const listCredentialGroupSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.listSettings,
  resolveContext: ({ input }: { input: ListCredentialGroupSettingsInput }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    return { credentialGroups: await listCredentialGroups(context.workspaceId) }
  },
})

export interface CreateCredentialGroupSettingsInput {
  workspaceId: string
  credentialGroup: CreateCredentialGroupInput
}

export const createCredentialGroupSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.create,
  resolveContext: ({ input }: { input: CreateCredentialGroupSettingsInput }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    try {
      const credentialGroup = await createCredentialGroup(
        context.workspaceId,
        principal.userId,
        validateCreateCredentialGroupInput(input.credentialGroup)
      )
      return { credentialGroup }
    } catch (error) {
      throwCredentialGroupConflict(error)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: result.credentialGroup.id,
    resourceName: result.credentialGroup.name,
    description: 'Created a Credential Group',
  }),
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
    try {
      const credentialGroup = await updateCredentialGroup(
        context.workspaceId,
        context.credentialGroupId,
        validateUpdateCredentialGroupInput(input.update)
      )
      if (!credentialGroup) {
        throw new OrchestrationError('not_found', 'Credential group not found')
      }
      return { credentialGroup }
    } catch (error) {
      throwCredentialGroupConflict(error)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: result.credentialGroup.id,
    resourceName: result.credentialGroup.name,
    description: 'Updated a Credential Group',
  }),
})

export const deleteCredentialGroupSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.delete,
  resolveContext: ({ input }: { input: CredentialGroupSettingsTargetInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    const deleted = await deleteCredentialGroup(context.workspaceId, context.credentialGroupId)
    if (!deleted) throw new OrchestrationError('not_found', 'Credential group not found')
    return { success: true as const }
  },
  projectAudit: ({ context }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: 'Deleted a Credential Group',
  }),
})
