import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credentialGroup } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import { assertOperationPrincipal, type OperationUseCase } from '@/lib/core/application/operation'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import { authorizeWorkspaceOperation } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import {
  consumeSlackManagedUsersAttempt,
  createSlackManagedUsersAttempt,
  exchangeAndConfigureSlackManagedUsers,
  loadSlackManagedUsersAttempt,
} from '@/lib/credential-groups/slack-managed-users'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

async function authorizeSlackConfiguration(
  principal: Principal,
  operation:
    | typeof credentialGroupOperations.startSlackConfiguration
    | typeof credentialGroupOperations.completeSlackConfiguration,
  scope: ResourceScope
) {
  assertOperationPrincipal(principal, operation)
  if (scope.kind === 'organization') {
    await requireOrganizationMembership(
      principal,
      scope.organizationId,
      operation.minimumRole,
      operation.capability
    )
  } else {
    const context = await loadActiveWorkspaceApplicationContext(scope.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    await authorizeWorkspaceOperation(principal, operation, context)
  }
  if (!(await isScopedCredentialGroupsAvailable(scope))) {
    throw new OrchestrationError('not_found', 'Connected accounts are not available')
  }
}

async function resolveCredentialGroup(groupId: string, assertedScope: ResourceScope) {
  const [group] = await db
    .select({
      id: credentialGroup.id,
      workspaceId: credentialGroup.workspaceId,
      organizationId: credentialGroup.organizationId,
    })
    .from(credentialGroup)
    .where(eq(credentialGroup.id, groupId))
    .limit(1)
  if (!group || !sameResourceScope(resourceScopeFromOwner(group), assertedScope)) {
    throw new OrchestrationError('not_found', 'Connected accounts not found')
  }
  return resourceScopeFromOwner(group)
}

export interface StartSlackCredentialGroupConfigurationInput {
  assertedWorkspaceId?: string
  organizationId?: string
  credentialGroupId: string
  slackBotCredentialId?: string
  appId?: string
  teamId?: string
  clientId: string
  clientSecret: string
  requiredScopes?: string[]
}

export const startSlackCredentialGroupConfiguration: OperationUseCase<
  typeof credentialGroupOperations.startSlackConfiguration,
  StartSlackCredentialGroupConfigurationInput,
  Awaited<ReturnType<typeof createSlackManagedUsersAttempt>>
> = {
  operation: credentialGroupOperations.startSlackConfiguration,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, credentialGroupOperations.startSlackConfiguration)
    const scope = await resolveCredentialGroup(
      input.credentialGroupId,
      resourceScopeFromOwner({
        workspaceId: input.assertedWorkspaceId,
        organizationId: input.organizationId,
      })
    )
    await authorizeSlackConfiguration(
      principal,
      credentialGroupOperations.startSlackConfiguration,
      scope
    )
    if (scope.kind === 'organization')
      await requireOrganizationAccountsSetup(scope.organizationId, input.credentialGroupId)
    return createSlackManagedUsersAttempt({
      ...resourceScopeFields(scope),
      userId: principal.userId,
      credentialGroupId: input.credentialGroupId,
      slackBotCredentialId: input.slackBotCredentialId,
      appId: input.appId,
      teamId: input.teamId,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      requiredScopes: input.requiredScopes,
    })
  },
}

interface SlackCredentialGroupConfigurationCallbackInput {
  state: string
  code?: string
  providerError?: string
}

type SlackConfigurationResult =
  | { ok: false; reason: 'provider_error' }
  | {
      ok: true
      reason: 'authorized'
      result: Awaited<ReturnType<typeof exchangeAndConfigureSlackManagedUsers>>
    }

export const completeSlackCredentialGroupConfiguration: OperationUseCase<
  typeof credentialGroupOperations.completeSlackConfiguration,
  SlackCredentialGroupConfigurationCallbackInput,
  SlackConfigurationResult
> = {
  operation: credentialGroupOperations.completeSlackConfiguration,
  async execute({ principal, input, request }) {
    assertOperationPrincipal(principal, credentialGroupOperations.completeSlackConfiguration)
    const pending = await loadSlackManagedUsersAttempt(input.state)
    if (!pending)
      throw new OrchestrationError('validation', 'Authorization state is invalid or expired')
    if (pending.userId !== principal.userId) {
      throw new OrchestrationError(
        'forbidden',
        'Authorization must be completed by the user who started it'
      )
    }
    const scope = await resolveCredentialGroup(
      pending.credentialGroupId,
      resourceScopeFromOwner(pending)
    )
    await authorizeSlackConfiguration(
      principal,
      credentialGroupOperations.completeSlackConfiguration,
      scope
    )
    if (scope.kind === 'organization')
      await requireOrganizationAccountsSetup(scope.organizationId, pending.credentialGroupId)
    const attempt = await consumeSlackManagedUsersAttempt(input.state)
    if (
      !attempt ||
      !sameResourceScope(resourceScopeFromOwner(attempt), scope) ||
      attempt.userId !== pending.userId ||
      attempt.credentialGroupId !== pending.credentialGroupId ||
      attempt.credentialGroupUpdatedAt !== pending.credentialGroupUpdatedAt ||
      attempt.slackBotCredentialId !== pending.slackBotCredentialId ||
      attempt.slackBotCredentialUpdatedAt !== pending.slackBotCredentialUpdatedAt ||
      attempt.expectedAppId !== pending.expectedAppId ||
      attempt.expectedTeamId !== pending.expectedTeamId ||
      attempt.clientId !== pending.clientId ||
      attempt.redirectUri !== pending.redirectUri ||
      credentialGroupScopePolicyVersion(attempt.requiredScopes) !==
        credentialGroupScopePolicyVersion(pending.requiredScopes) ||
      attempt.createdAt !== pending.createdAt
    ) {
      throw new OrchestrationError('validation', 'Authorization state is invalid or expired')
    }
    if (input.providerError) return { ok: false as const, reason: 'provider_error' as const }
    if (!input.code) throw new OrchestrationError('validation', 'Authorization code is missing')
    const result = await exchangeAndConfigureSlackManagedUsers({ attempt, code: input.code })
    recordProjectedUseCaseAuditEntries(
      credentialGroupOperations.completeSlackConfiguration,
      scope.kind === 'workspace' ? scope.workspaceId : undefined,
      principal,
      request,
      [
        {
          action: AuditAction.CREDENTIAL_GROUP_UPDATED,
          resourceType: AuditResourceType.CREDENTIAL_GROUP,
          resourceId: result.credentialGroupId,
          resourceName: result.credentialGroupName,
          description: 'Configured Slack for connected accounts',
          metadata: {
            ...resourceScopeFields(scope),
            slackBotCredentialId: result.slackBotCredentialId,
            slackAppId: result.appId,
            slackTeamId: result.teamId,
            requiredScopes: result.requiredScopes,
          },
        },
      ],
      scope.kind === 'organization' ? scope.organizationId : undefined
    )
    return { ok: true, reason: 'authorized', result }
  },
}
