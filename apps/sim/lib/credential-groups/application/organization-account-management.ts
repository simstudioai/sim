import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import { validateCredentialGroupInvitationEmails } from '@/lib/credential-groups/application/validation'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import {
  inviteCredentialGroupEnrollments,
  listCredentialGroupEnrollments,
  loadCredentialGroupInviterIdentity,
  resendCredentialGroupEnrollment,
  revokeCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import { getCredentialGroupIndexingConnector } from '@/lib/credential-groups/indexing'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  type CreateManagedMcpConnectorInput,
  createManagedMcpConnector,
  deleteManagedMcpConnector,
} from '@/lib/credential-groups/managed-mcp-service'
import { clearCredentialGroupMcpOAuthAttempts } from '@/lib/credential-groups/mcp-oauth-state'
import { isCredentialGroupProvider } from '@/lib/credential-groups/providers'
import { evictMcpServerConnections } from '@/lib/mcp/connection-pool'

export const organizationAccountManagementOperations = {
  people: defineOrganizationOperation({
    id: 'organization_accounts.people.list',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  invite: defineOrganizationOperation({
    id: 'organization_accounts.people.invite',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  resend: defineOrganizationOperation({
    id: 'organization_accounts.people.resend',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  revoke: defineOrganizationOperation({
    id: 'organization_accounts.people.revoke',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  addMcp: defineOrganizationOperation({
    id: 'organization_accounts.mcp.add',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  removeMcp: defineOrganizationOperation({
    id: 'organization_accounts.mcp.remove',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
} as const

interface OrganizationInput {
  organizationId: string
}
interface OrganizationExecution<I extends OrganizationInput> {
  input: I
  context: OrganizationMembershipContext
}

async function requireGroup(organizationId: string) {
  const scope = { kind: 'organization' as const, organizationId }
  const group = await loadScopedAccountsCredentialListContext(scope)
  if (!group)
    throw new OrchestrationError('not_found', 'Organization connected accounts are not configured')
  return { scope, group }
}

async function requireInviterName(userId: string) {
  const inviter = await loadCredentialGroupInviterIdentity(userId)
  const name = inviter?.name?.trim() || inviter?.email
  if (!name) throw new OrchestrationError('conflict', 'Inviting user has no display identity')
  return name
}

function searchConnectionIntent(
  group: Awaited<ReturnType<typeof requireGroup>>['group'],
  optionId?: string
) {
  if (!optionId) return undefined
  const option = group.options.find((item) => item.id === optionId && item.status === 'active')
  const connector =
    option && isCredentialGroupProvider(option.provider)
      ? getCredentialGroupIndexingConnector(option.provider)
      : undefined
  if (!connector)
    throw new OrchestrationError('not_found', 'Search account provider is no longer available')
  return { optionId, providerName: connector.meta.name }
}

function groupAudit(result: { credentialGroupId: string; description: string }) {
  return {
    resourceId: result.credentialGroupId,
    resourceName: 'Connected accounts',
    description: result.description,
  }
}

async function evictConnections(connectionIds: string[]) {
  await Promise.all(
    connectionIds.map((id) =>
      evictMcpServerConnections(id, 'organization connected accounts changed')
    )
  )
}

export const listOrganizationAccountPeople = defineOrganizationAccountsUseCase({
  operation: organizationAccountManagementOperations.people,
  async execute({
    input,
    context,
  }: OrganizationExecution<
    OrganizationInput & {
      limit: number
      cursor?: string
      email?: string
      search?: string
      optionId?: string
    }
  >) {
    const { scope, group } = await requireGroup(context.organizationId)
    return listCredentialGroupEnrollments(
      scope,
      group.credentialGroupId,
      input.limit,
      input.cursor,
      {
        email: input.email,
        search: input.search,
        ...(input.optionId ? { optionId: input.optionId } : {}),
      }
    )
  },
})

export const inviteOrganizationAccountPeople = defineOrganizationAccountsUseCase({
  operation: organizationAccountManagementOperations.invite,
  async execute({
    input,
    context,
  }: OrganizationExecution<OrganizationInput & { emails: string[]; optionId?: string }>) {
    const emails = validateCredentialGroupInvitationEmails(input.emails)
    const { scope, group } = await requireGroup(context.organizationId)
    const result = await inviteCredentialGroupEnrollments(
      scope,
      group.credentialGroupId,
      context.userId,
      await requireInviterName(context.userId),
      { emails },
      searchConnectionIntent(group, input.optionId)
    )
    return {
      ...result,
      credentialGroupId: group.credentialGroupId,
      description: `Sent ${result.sentCount} connected account invitations`,
    }
  },
  projectAudit: groupAudit,
})

export const resendOrganizationAccountInvitation = defineOrganizationAccountsUseCase({
  operation: organizationAccountManagementOperations.resend,
  async execute({
    input,
    context,
  }: OrganizationExecution<OrganizationInput & { enrollmentId: string; optionId?: string }>) {
    const { scope, group } = await requireGroup(context.organizationId)
    const enrollment = await resendCredentialGroupEnrollment(
      scope,
      group.credentialGroupId,
      input.enrollmentId,
      context.userId,
      await requireInviterName(context.userId),
      searchConnectionIntent(group, input.optionId)
    )
    return {
      credentialGroupEnrollment: enrollment,
      credentialGroupId: group.credentialGroupId,
      description: 'Resent a connected account invitation',
    }
  },
  projectAudit: groupAudit,
})

export const revokeOrganizationAccountEnrollment = defineOrganizationAccountsUseCase({
  operation: organizationAccountManagementOperations.revoke,
  async execute({
    input,
    context,
  }: OrganizationExecution<OrganizationInput & { enrollmentId: string }>) {
    const { scope, group } = await requireGroup(context.organizationId)
    const result = await revokeCredentialGroupEnrollment(
      scope,
      group.credentialGroupId,
      input.enrollmentId
    )
    return {
      ...result,
      credentialGroupId: group.credentialGroupId,
      description: 'Revoked a person’s connected accounts',
    }
  },
  projectAudit: groupAudit,
  afterSuccess: ({ result }) => evictConnections(result.retiredMcpConnectionIds),
})

export const addOrganizationAccountMcpProvider = defineOrganizationAccountsUseCase({
  operation: organizationAccountManagementOperations.addMcp,
  async execute({
    input,
    context,
  }: OrganizationExecution<OrganizationInput & CreateManagedMcpConnectorInput>) {
    const { group } = await requireGroup(context.organizationId)
    const { organizationId: _organizationId, ...connectorInput } = input
    const result = await createManagedMcpConnector({
      organizationId: context.organizationId,
      credentialGroupId: group.credentialGroupId,
      userId: context.userId,
      input: connectorInput,
    })
    return {
      ...result,
      credentialGroupId: group.credentialGroupId,
      description: `Added ${result.mcpServer.name} to connected accounts`,
    }
  },
  projectAudit: groupAudit,
})

export const removeOrganizationAccountMcpProvider = defineOrganizationAccountsUseCase({
  operation: organizationAccountManagementOperations.removeMcp,
  async execute({
    input,
    context,
  }: OrganizationExecution<OrganizationInput & { connectorId: ManagedMcpConnectorId }>) {
    const { group } = await requireGroup(context.organizationId)
    const result = await deleteManagedMcpConnector({
      organizationId: context.organizationId,
      credentialGroupId: group.credentialGroupId,
      connectorId: input.connectorId,
    })
    return {
      ...result,
      credentialGroupId: group.credentialGroupId,
      description: `Removed ${result.mcpServer.name} from connected accounts`,
    }
  },
  projectAudit: groupAudit,
  async afterSuccess({ result }) {
    await clearCredentialGroupMcpOAuthAttempts(result.serverIds)
    await evictConnections([...result.serverIds, ...result.retiredMcpConnectionIds])
  },
})
