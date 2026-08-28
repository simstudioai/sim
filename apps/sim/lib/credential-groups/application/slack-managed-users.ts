import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { credentialGroup } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import {
  consumeSlackManagedUsersAttempt,
  createSlackManagedUsersAttempt,
  exchangeAndConfigureSlackManagedUsers,
  loadSlackManagedUsersAttempt,
  type SlackManagedUsersAttempt,
} from '@/lib/credential-groups/slack-managed-users'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

async function requireCredentialGroups(workspaceId: string): Promise<void> {
  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(workspaceId)
  if (!(await isCredentialGroupsAvailable({ workspaceId, ownerBilling }))) {
    throw new OrchestrationError('not_found', 'Credential Groups are not available')
  }
}

async function resolveWorkspace(workspaceId: string) {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveCredentialGroup(groupId: string, assertedWorkspaceId: string) {
  const [group] = await db
    .select({ id: credentialGroup.id, workspaceId: credentialGroup.workspaceId })
    .from(credentialGroup)
    .where(eq(credentialGroup.id, groupId))
    .limit(1)
  if (!group || group.workspaceId !== assertedWorkspaceId) {
    throw new OrchestrationError('not_found', 'Credential Group not found')
  }
  return { ...(await resolveWorkspace(group.workspaceId)), credentialGroupId: group.id }
}

export interface StartSlackCredentialGroupConfigurationInput {
  assertedWorkspaceId: string
  credentialGroupId: string
  slackBotCredentialId: string
  clientId: string
  clientSecret: string
}

export const startSlackCredentialGroupConfiguration = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.startSlackConfiguration,
  resolveContext: ({ input }: { input: StartSlackCredentialGroupConfigurationInput }) =>
    resolveCredentialGroup(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireCredentialGroups(context.workspaceId)
    return createSlackManagedUsersAttempt({
      workspaceId: context.workspaceId,
      userId: principal.userId,
      credentialGroupId: context.credentialGroupId,
      slackBotCredentialId: input.slackBotCredentialId,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    })
  },
})

interface SlackCredentialGroupConfigurationCallbackInput {
  state: string
  code?: string
  providerError?: string
}

type SlackCredentialGroupConfigurationCallbackContext = Awaited<
  ReturnType<typeof resolveWorkspace>
> & {
  attempt: SlackManagedUsersAttempt
}

export const completeSlackCredentialGroupConfiguration = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.completeSlackConfiguration,
  resolveContext: async ({
    principal,
    input,
  }: {
    principal: { kind: 'session'; userId: string; sessionId: string }
    input: SlackCredentialGroupConfigurationCallbackInput
  }): Promise<SlackCredentialGroupConfigurationCallbackContext> => {
    const attempt = await loadSlackManagedUsersAttempt(input.state)
    if (!attempt) {
      throw new OrchestrationError('validation', 'Authorization state is invalid or expired')
    }
    if (attempt.userId !== principal.userId) {
      throw new OrchestrationError(
        'forbidden',
        'Authorization must be completed by the user who started it'
      )
    }
    return { ...(await resolveWorkspace(attempt.workspaceId)), attempt }
  },
  authorizationOptions: {},
  async execute({ input, context }) {
    await requireCredentialGroups(context.workspaceId)
    const attempt = await consumeSlackManagedUsersAttempt(input.state)
    if (
      !attempt ||
      attempt.workspaceId !== context.attempt.workspaceId ||
      attempt.userId !== context.attempt.userId ||
      attempt.credentialGroupId !== context.attempt.credentialGroupId ||
      attempt.slackBotCredentialId !== context.attempt.slackBotCredentialId ||
      attempt.clientId !== context.attempt.clientId ||
      attempt.createdAt !== context.attempt.createdAt
    ) {
      throw new OrchestrationError('validation', 'Authorization state is invalid or expired')
    }
    if (input.providerError) return { ok: false as const, reason: 'provider_error' as const }
    if (!input.code) throw new OrchestrationError('validation', 'Authorization code is missing')
    const result = await exchangeAndConfigureSlackManagedUsers({ attempt, code: input.code })
    return { ok: true as const, reason: 'authorized' as const, result }
  },
  projectAudit: ({ result }) =>
    result.ok
      ? {
          action: AuditAction.CREDENTIAL_GROUP_UPDATED,
          resourceType: AuditResourceType.CREDENTIAL_GROUP,
          resourceId: result.result.credentialGroupId,
          resourceName: result.result.credentialGroupName,
          description: 'Configured Slack for a Credential Group',
          metadata: {
            slackBotCredentialId: result.result.slackBotCredentialId,
            slackAppId: result.result.appId,
            slackTeamId: result.result.teamId,
          },
        }
      : [],
})
