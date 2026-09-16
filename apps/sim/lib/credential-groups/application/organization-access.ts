import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import {
  buildOrganizationAccountAccessPolicy,
  listOrganizationAccountWorkspaceIds,
  organizationAccountAccessPolicyCodec,
  organizationAccountWorkspaceIdsSchema,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import {
  ResourcePolicyRevisionConflictError,
  requireResourcePolicy,
  writeResourcePolicy,
} from '@/lib/resource-policies/repository'

export const organizationAccountAccessOperations = {
  read: defineOrganizationOperation({
    id: 'organization_accounts.workspace_access.read',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  update: defineOrganizationOperation({
    id: 'organization_accounts.workspace_access.update',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
} as const

async function requireGroup(organizationId: string) {
  const group = await loadScopedAccountsCredentialListContext({
    kind: 'organization',
    organizationId,
  })
  if (!group)
    throw new OrchestrationError('not_found', 'Organization connected accounts are not configured')
  return group
}

export const getOrganizationAccountWorkspaceAccess = defineOrganizationAccountsUseCase({
  operation: organizationAccountAccessOperations.read,
  async execute({ context }) {
    const group = await requireGroup(context.organizationId)
    const [policy, workspaces] = await Promise.all([
      requireResourcePolicy({
        organizationId: context.organizationId,
        resourceType: 'credential_group',
        resourceId: group.credentialGroupId,
        codec: organizationAccountAccessPolicyCodec,
      }),
      db
        .select({ id: workspace.id, name: workspace.name })
        .from(workspace)
        .where(
          and(eq(workspace.organizationId, context.organizationId), isNull(workspace.archivedAt))
        )
        .orderBy(asc(workspace.name), asc(workspace.id))
        .limit(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT + 1),
    ])
    if (workspaces.length > ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
      throw new OrchestrationError(
        'validation',
        `Workspace access supports at most ${ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT} workspaces`
      )
    return {
      revision: policy.revision,
      workspaceIds: listOrganizationAccountWorkspaceIds(policy.document),
      workspaces,
    }
  },
})

export const updateOrganizationAccountWorkspaceAccess = defineOrganizationAccountsUseCase({
  operation: organizationAccountAccessOperations.update,
  async execute({
    input,
    context,
  }: {
    input: { organizationId: string; revision: number; workspaceIds: string[] }
    context: OrganizationMembershipContext
  }) {
    const parsed = organizationAccountWorkspaceIdsSchema.safeParse(input.workspaceIds)
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        'Workspace IDs must be unique, valid identifiers within the supported limit'
      )
    const group = await requireGroup(context.organizationId)
    if (parsed.data.length) {
      const rows = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            eq(workspace.organizationId, context.organizationId),
            inArray(workspace.id, parsed.data),
            isNull(workspace.archivedAt)
          )
        )
      if (rows.length !== parsed.data.length)
        throw new OrchestrationError(
          'validation',
          'Every allowed workspace must be active and belong to this organization'
        )
    }
    try {
      const policy = await writeResourcePolicy({
        organizationId: context.organizationId,
        resourceType: 'credential_group',
        resourceId: group.credentialGroupId,
        codec: organizationAccountAccessPolicyCodec,
        expectedRevision: input.revision,
        document: buildOrganizationAccountAccessPolicy(group.credentialGroupId, parsed.data),
        actorUserId: context.userId,
      })
      return {
        credentialGroupId: group.credentialGroupId,
        name: group.name,
        revision: policy.revision,
        workspaceIds: listOrganizationAccountWorkspaceIds(policy.document),
      }
    } catch (error) {
      if (error instanceof ResourcePolicyRevisionConflictError)
        throw new OrchestrationError(
          'conflict',
          'Workspace access changed. Reload before saving again.'
        )
      throw error
    }
  },
  projectAudit: (result) => ({
    resourceId: result.credentialGroupId,
    resourceName: result.name,
    description: `Allowed ${result.workspaceIds.length} workspaces to use organization connected accounts`,
  }),
})
