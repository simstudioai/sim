import { AuditAction, AuditResourceType } from '@sim/audit'
import { generateId } from '@sim/utils/id'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveCredentialGroupSettingsContext } from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { validateResourcePolicySubjects } from '@/lib/resource-policies/management'
import {
  loadResourcePolicy,
  ResourcePolicyRevisionConflictError,
  writeResourcePolicy,
} from '@/lib/resource-policies/repository'
import {
  RESOURCE_POLICY_VERSION,
  type ResourcePolicySubject,
  resourcePolicySubjectSchema,
} from '@/lib/resource-policies/types'

const CREDENTIAL_GROUP_ACCESS_ACTIONS = ['credential_groups.credentials.use'] as const

interface CredentialGroupAccessTargetInput {
  assertedWorkspaceId: string
  credentialGroupId: string
}

function presentPolicy(
  policy: Awaited<ReturnType<typeof loadResourcePolicy>>,
  expected: { credentialGroupId: string; workspaceId: string }
) {
  if (!policy) {
    return { revision: 0, grants: [] }
  }
  if (policy.workspaceId !== expected.workspaceId) {
    throw new Error('Credential Group policy has the wrong workspace binding')
  }
  if (policy.document.resource.id !== expected.credentialGroupId) {
    throw new Error('Credential Group policy has the wrong resource binding')
  }
  return {
    revision: policy.revision,
    grants: policy.document.grants.map((grant) => ({ id: grant.id, subject: grant.subject })),
  }
}

export const readCredentialGroupAccess = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.readAccess,
  resolveContext: ({ input }: { input: CredentialGroupAccessTargetInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ context }) {
    const policy = await loadResourcePolicy({
      resourceType: 'credential_group',
      resourceId: context.credentialGroupId,
    })
    return presentPolicy(policy, {
      credentialGroupId: context.credentialGroupId,
      workspaceId: context.workspaceId,
    })
  },
})

export interface UpdateCredentialGroupAccessInput extends CredentialGroupAccessTargetInput {
  expectedRevision: number
  grants: Array<{ id?: string; subject: ResourcePolicySubject }>
}

export const updateCredentialGroupAccess = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.updateAccess,
  resolveContext: ({ input }: { input: UpdateCredentialGroupAccessInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new OrchestrationError('validation', 'Expected policy revision must be non-negative')
    }
    const subjects = input.grants.map((grant) => resourcePolicySubjectSchema.parse(grant.subject))
    await validateResourcePolicySubjects(subjects, context)
    try {
      const policy = await writeResourcePolicy({
        workspaceId: context.workspaceId,
        resourceType: 'credential_group',
        resourceId: context.credentialGroupId,
        expectedRevision: input.expectedRevision,
        actorUserId: principal.userId,
        document: {
          version: RESOURCE_POLICY_VERSION,
          resource: { type: 'credential_group', id: context.credentialGroupId },
          grants: input.grants.map((grant, index) => ({
            id: grant.id ?? generateId(),
            subject: subjects[index],
            actions: [...CREDENTIAL_GROUP_ACCESS_ACTIONS],
          })),
        },
      })
      return presentPolicy(policy, {
        credentialGroupId: context.credentialGroupId,
        workspaceId: context.workspaceId,
      })
    } catch (error) {
      if (error instanceof ResourcePolicyRevisionConflictError) {
        throw new OrchestrationError('conflict', error.message)
      }
      throw error
    }
  },
  projectAudit: ({ result, context }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: 'Updated Credential Group access grants',
    metadata: { revision: result.revision, grantCount: result.grants.length },
  }),
})
