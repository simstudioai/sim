import { db } from '@sim/db'
import { ORGANIZATION_ACCOUNT_POLICY_DOCUMENT_MAX_BYTES } from '@sim/db/credential-group-resource-policies'
import { workspace } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import {
  buildOrganizationAccountAccessPolicy,
  listOrganizationAccountWorkspaceGrants,
  organizationAccountAccessPolicyCodec,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { getOrganizationCredentialTypeCatalog } from '@/lib/credential-groups/credential-types'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import {
  type OrganizationAccountWorkspaceGrant,
  organizationAccountWorkspaceGrantsSchema,
} from '@/lib/credential-groups/workspace-grants'
import {
  ResourcePolicyRevisionConflictError,
  requireResourcePolicy,
  writeResourcePolicy,
} from '@/lib/resource-policies/repository'

export const organizationAccountAccessOperations = {
  read: defineOrganizationOperation({
    id: 'organization_accounts.workspace_access.read',
    minimumRole: 'admin',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    capability: 'integrations.manage',
  }),
  update: defineOrganizationOperation({
    id: 'organization_accounts.workspace_access.update',
    minimumRole: 'admin',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
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
      grants: listOrganizationAccountWorkspaceGrants(policy.document),
      workspaces,
      credentialTypes: getOrganizationCredentialTypeCatalog(),
    }
  },
})

export const updateOrganizationAccountWorkspaceAccess = defineOrganizationAccountsUseCase({
  operation: organizationAccountAccessOperations.update,
  async execute({
    input,
    context,
  }: {
    input: { organizationId: string; revision: number; grants: OrganizationAccountWorkspaceGrant[] }
    context: OrganizationMembershipContext
  }) {
    const parsed = organizationAccountWorkspaceGrantsSchema.safeParse(input.grants)
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        'Workspace grants must contain unique workspace IDs and valid integration selections'
      )
    const group = await requireGroup(context.organizationId)
    if (parsed.data.length) {
      const rows = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            eq(workspace.organizationId, context.organizationId),
            inArray(
              workspace.id,
              parsed.data.map((grant) => grant.workspaceId)
            ),
            isNull(workspace.archivedAt)
          )
        )
      if (rows.length !== parsed.data.length)
        throw new OrchestrationError(
          'validation',
          'Every allowed workspace must be active and belong to this organization'
        )
    }
    const document = buildOrganizationAccountAccessPolicy(group.credentialGroupId, parsed.data)
    /** Indented JSON conservatively includes the whitespace PostgreSQL adds to jsonb text. */
    if (
      Buffer.byteLength(JSON.stringify(document, null, 1), 'utf8') >
      ORGANIZATION_ACCOUNT_POLICY_DOCUMENT_MAX_BYTES
    ) {
      throw new OrchestrationError(
        'validation',
        'Workspace access policy is too large. Reduce the number of selected integrations or workspaces.'
      )
    }
    try {
      const policy = await writeResourcePolicy({
        organizationId: context.organizationId,
        resourceType: 'credential_group',
        resourceId: group.credentialGroupId,
        codec: organizationAccountAccessPolicyCodec,
        expectedRevision: input.revision,
        document,
        actorUserId: context.userId,
      })
      return {
        credentialGroupId: group.credentialGroupId,
        name: group.name,
        revision: policy.revision,
        grants: listOrganizationAccountWorkspaceGrants(policy.document),
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
    description: `Allowed ${result.grants.length} workspaces to use organization connected accounts`,
  }),
})
