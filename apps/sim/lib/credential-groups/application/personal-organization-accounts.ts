import { AuditAction, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  mcpServers,
  organization,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { sameResourceScopeCondition } from '@/lib/core/resource-scope.server'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import type { DbOrTx } from '@/lib/db/types'
import { evictMcpServerConnections } from '@/lib/mcp/connection-pool'

/** Contributors retain control of their own grants even without organization or workspace membership. */
export const personalOrganizationAccountOperations = {
  /**
   * permission-group-exempt: Contributors retain control of their own grants after organization membership ends.
   */
  list: defineOperation({
    id: 'organization_accounts.personal.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /**
   * permission-group-exempt: Contributors retain control of their own grants after organization membership ends.
   */
  reconnect: defineOperation({
    id: 'organization_accounts.personal.reconnect',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /**
   * permission-group-exempt: Contributors retain control of their own grants after organization membership ends.
   */
  disconnect: defineOperation({
    id: 'organization_accounts.personal.disconnect',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const

function ownAccounts(
  userId: string,
  input: { credentialId?: string; cursor?: string },
  executor: DbOrTx = db
) {
  return executor
    .select({
      credentialId: credential.id,
      displayName: credential.displayName,
      providerId: credential.providerId,
      type: credential.type,
      status: credential.managedOauthStatus,
      organizationId: organization.id,
      organizationName: organization.name,
      groupId: credentialGroup.id,
      groupStatus: credentialGroup.status,
      enrollmentId: credentialGroupEnrollment.id,
      enrollmentStatus: credentialGroupEnrollment.status,
      optionId: credential.credentialGroupOptionId,
      mcpProvider: mcpServers.managedConnectorId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(organization, eq(organization.id, credentialGroup.organizationId))
    .leftJoin(mcpServers, eq(mcpServers.id, credential.mcpServerId))
    .where(
      and(
        eq(credentialGroupEnrollment.userId, userId),
        sameResourceScopeCondition(credential, credentialGroup),
        isNotNull(credential.organizationId),
        inArray(credential.type, ['managed_oauth', 'managed_mcp']),
        input.credentialId ? eq(credential.id, input.credentialId) : undefined,
        input.cursor ? gt(credential.id, input.cursor) : undefined
      )
    )
    .orderBy(asc(credential.id))
    .limit(input.credentialId ? 1 : 51)
}

export const listPersonalOrganizationAccounts = defineAuthorizedCredentialUserUseCase({
  operation: personalOrganizationAccountOperations.list,
  async execute({ principal, input }: { principal: SessionPrincipal; input: { cursor?: string } }) {
    const rows = await ownAccounts(principal.userId, input)
    const page = rows.slice(0, 50)
    return {
      accounts: page.map((row) => {
        const providerId = row.type === 'managed_mcp' ? row.mcpProvider : row.providerId
        if (!providerId || !row.status)
          throw new Error('Organization account identity is incomplete')
        return {
          credentialId: row.credentialId,
          displayName: row.displayName,
          providerId,
          kind: row.type === 'managed_mcp' ? ('mcp' as const) : ('oauth' as const),
          status: row.status,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          enrollmentStatus: row.enrollmentStatus,
          canReconnect: row.groupStatus === 'active' && row.enrollmentStatus !== 'revoked',
        }
      }),
      nextCursor: rows.length > 50 ? page.at(-1)!.credentialId : null,
    }
  },
})

export const reconnectPersonalOrganizationAccount = defineAuthorizedCredentialUserUseCase({
  operation: personalOrganizationAccountOperations.reconnect,
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { credentialId: string }
  }) {
    const [account] = await ownAccounts(principal.userId, input)
    if (!account) throw new OrchestrationError('not_found', 'Connected account not found')
    if (account.groupStatus !== 'active' || account.enrollmentStatus === 'revoked')
      throw new OrchestrationError(
        'forbidden',
        'An organization admin must restore your access before you reconnect'
      )
    if (
      !(await isScopedCredentialGroupsAvailable({
        kind: 'organization',
        organizationId: account.organizationId,
      }))
    )
      throw new OrchestrationError('forbidden', 'Organization connected accounts are unavailable')
    const { invitationLink } = await createViewerCredentialGroupEnrollment({
      organizationId: account.organizationId,
      credentialGroupId: account.groupId,
      userId: principal.userId,
    })
    const url = new URL(invitationLink)
    if (account.optionId) url.searchParams.set('optionId', account.optionId)
    return { invitationLink: url.toString() }
  },
})

export const disconnectPersonalOrganizationAccount = defineAuthorizedCredentialUserUseCase({
  operation: personalOrganizationAccountOperations.disconnect,
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { credentialId: string }
  }) {
    const [account] = await ownAccounts(principal.userId, input)
    if (!account) throw new OrchestrationError('not_found', 'Connected account not found')
    await db.transaction(async (tx) => {
      await lockCredentialGroupEnrollmentLifecycle(tx, account.enrollmentId)
      const [current] = await ownAccounts(principal.userId, input, tx)
      if (!current || current.enrollmentId !== account.enrollmentId)
        throw new OrchestrationError('not_found', 'Connected account not found')
      await tx
        .update(credential)
        .set({ managedOauthStatus: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(credential.id, current.credentialId))
      await tx
        .update(credentialGroupEnrollment)
        .set({ invitationTokenHash: sha256Hex(generateId()), updatedAt: new Date() })
        .where(eq(credentialGroupEnrollment.id, current.enrollmentId))
    })
    return {
      success: true as const,
      credentialId: account.credentialId,
      organizationId: account.organizationId,
      managedMcp: account.type === 'managed_mcp',
    }
  },
  projectAudit: ({ input, result }) => ({
    workspaceId: null,
    action: AuditAction.CREDENTIAL_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: input.credentialId,
    description: 'Disconnected own organization account',
    metadata: { organizationId: result.organizationId },
  }),
  afterSuccess: async ({ result }) => {
    if (result.managedMcp)
      await evictMcpServerConnections(
        result.credentialId,
        'contributor disconnected organization account'
      )
  },
})
