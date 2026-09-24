import { AuditAction, AuditResourceType } from '@sim/audit'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import type {
  ConfigureSecretSourceBody,
  SaveOrganizationSecretsBody,
} from '@/lib/api/contracts/organization-secrets'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { organizationSecretOperations } from '@/lib/organization-secrets/application/operations'
import * as repository from '@/lib/organization-secrets/repository'
import {
  mountedSecretNamesSchema,
  type SecretSourceMode,
  secretChangesSchema,
  secretSourceModeSchema,
} from '@/lib/organization-secrets/validation'
import { defineOrganizationConfigurationUseCase } from '@/lib/organizations/application/authorized-configuration-use-case'

interface OrganizationInput {
  organizationId: string
}
interface EditorInput extends OrganizationInput {
  mode: SecretSourceMode
}

function requireEditorAccess(context: OrganizationMembershipContext, mode: SecretSourceMode) {
  secretSourceModeSchema.parse(mode)
  if (mode === 'organization' && !isOrgAdminRole(context.role)) {
    throw new OrchestrationError('forbidden', 'Organization administrator access is required')
  }
}

export const readOrganizationSecretSource = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.readSource,
  execute: async ({ input }: { input: OrganizationInput }) => ({
    source: await repository.readSecretSource(input.organizationId),
  }),
})

export const configureOrganizationSecretSource = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.configureSource,
  execute: async ({ input }: { input: OrganizationInput & ConfigureSecretSourceBody }) => ({
    source: await repository.configureSecretSource(
      input.organizationId,
      input.sourceId,
      secretSourceModeSchema.parse(input.mode)
    ),
  }),
  projectAudit: ({ result }) => ({
    action: AuditAction.ENVIRONMENT_UPDATED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: result.source.id,
    description: 'Configured Generic Secrets source',
    metadata: { mode: result.source.mode },
  }),
})

export const removeOrganizationSecretSource = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.removeSource,
  execute: async ({ input }: { input: OrganizationInput & { sourceId: string } }) => {
    await repository.removeSecretSource(input.organizationId, input.sourceId)
    return { success: true as const }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ENVIRONMENT_DELETED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: input.sourceId,
    description: 'Removed Generic Secrets source',
  }),
})

export const readOrganizationSecrets = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.read,
  execute: async ({
    input,
    context,
  }: {
    input: EditorInput
    context: OrganizationMembershipContext
  }) => {
    requireEditorAccess(context, input.mode)
    return repository.readSecrets(context, { mode: input.mode })
  },
})

export const saveOrganizationSecrets = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.save,
  execute: async ({
    input,
    context,
  }: {
    input: OrganizationInput & SaveOrganizationSecretsBody
    context: OrganizationMembershipContext
  }) => {
    requireEditorAccess(context, input.mode)
    const changes = secretChangesSchema.parse({ upsert: input.upsert, remove: input.remove })
    await repository.saveSecrets(context, { id: input.sourceId, mode: input.mode }, changes)
    return {
      success: true as const,
      changedNames: [...new Set([...Object.keys(changes.upsert), ...changes.remove])],
    }
  },
  projectAudit: ({ input, result }) =>
    result.changedNames.length
      ? {
          action: AuditAction.ENVIRONMENT_UPDATED,
          resourceType: AuditResourceType.ENVIRONMENT,
          resourceId: input.sourceId,
          description: 'Updated Generic Secrets',
          metadata: { mode: input.mode, keys: result.changedNames },
        }
      : undefined,
})

export const listOrganizationSecretNames = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.listNames,
  execute: async ({
    context,
  }: {
    input: OrganizationInput
    context: OrganizationMembershipContext
  }) => ({ names: await repository.listSecretNames(context) }),
})

export const mountOrganizationSecrets = defineOrganizationConfigurationUseCase({
  operation: organizationSecretOperations.mount,
  execute: async ({
    input,
    context,
  }: {
    input: OrganizationInput & { names: string[] }
    context: OrganizationMembershipContext
  }) => {
    const names = [...new Set(mountedSecretNamesSchema.parse(input.names))]
    return repository.materializeSecrets(context, names)
  },
})
