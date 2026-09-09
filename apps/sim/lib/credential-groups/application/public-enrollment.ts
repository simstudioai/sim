import type { CredentialGroupEnrollmentPrincipal, Principal } from '@sim/auth/principal'
import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { credentialGroupEnrollmentOperations } from '@/lib/credential-groups/application/enrollment-operations'
import {
  bindCredentialGroupEnrollmentUser,
  completeAuthorizedCredentialGroupEnrollment,
  getAuthorizedCredentialGroupMcpOAuthContext,
  getAuthorizedCredentialGroupOAuthContext,
  getAuthorizedPublicCredentialGroupEnrollment,
  getCredentialGroupMcpOAuthContextForEnrollment,
  getCredentialGroupOAuthContextForEnrollment,
  type PublicCredentialGroupEnrollmentIdentity,
} from '@/lib/credential-groups/enrollments'
import {
  completeCredentialGroupMcpOAuth,
  startCredentialGroupMcpOAuth,
} from '@/lib/credential-groups/mcp-oauth'
import type { CredentialGroupMcpOAuthAttempt } from '@/lib/credential-groups/mcp-oauth-state'
import {
  completeCredentialGroupOAuth,
  startCredentialGroupOAuth,
} from '@/lib/credential-groups/oauth'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { CredentialGroupInvitationUnavailableError } from '@/lib/credential-groups/provider-adapter'
import { fireCredentialGroupTrigger } from '@/lib/credential-groups/trigger'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'

interface AuthorizedCredentialGroupEnrollmentUseCaseDefinition<O, I, C, R> {
  operation: O
  resolveContext(args: { principal: CredentialGroupEnrollmentPrincipal; input: I }): Promise<C>
  execute(args: { principal: CredentialGroupEnrollmentPrincipal; input: I; context: C }): Promise<R>
}

function requireCredentialGroupEnrollmentPrincipal(
  principal: Principal
): asserts principal is CredentialGroupEnrollmentPrincipal {
  if (principal.kind !== 'credential_group_enrollment' || !principal.userId?.trim()) {
    throw new OrchestrationError(
      'forbidden',
      'This operation requires a Credential Group invitation'
    )
  }
}

function requireMatchingContext(
  principal: CredentialGroupEnrollmentPrincipal,
  context: PublicCredentialGroupEnrollmentIdentity
): void {
  if (
    !sameResourceScope(resourceScopeFromOwner(context), resourceScopeFromOwner(principal)) ||
    context.credentialGroupId !== principal.credentialGroupId ||
    context.enrollmentId !== principal.enrollmentId ||
    context.email !== principal.email ||
    context.userId !== principal.userId ||
    !safeCompare(context.invitationTokenHash, principal.invitationTokenHash)
  ) {
    throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  }
}

function defineAuthorizedCredentialGroupEnrollmentUseCase<
  const O extends
    (typeof credentialGroupEnrollmentOperations)[keyof typeof credentialGroupEnrollmentOperations],
  I,
  C extends PublicCredentialGroupEnrollmentIdentity,
  R,
>(
  definition: AuthorizedCredentialGroupEnrollmentUseCaseDefinition<O, I, C, R>
): OperationUseCase<O, I, R> {
  async function authorize(principal: Principal, input: I) {
    requireCredentialGroupEnrollmentPrincipal(principal)
    await bindCredentialGroupEnrollmentUser(identityFromPrincipal(principal), principal.userId)
    const context = await definition.resolveContext({ principal, input })
    requireMatchingContext(principal, context)
    return { principal, input, context }
  }

  return {
    operation: definition.operation,
    async authorize({ principal, input }) {
      await authorize(principal, input)
    },
    async execute({ principal, input }) {
      const authorized = await authorize(principal, input)
      return definition.execute(authorized)
    },
  }
}

function identityFromPrincipal(
  principal: CredentialGroupEnrollmentPrincipal
): PublicCredentialGroupEnrollmentIdentity {
  return {
    ...resourceScopeFields(resourceScopeFromOwner(principal)),
    credentialGroupId: principal.credentialGroupId,
    enrollmentId: principal.enrollmentId,
    email: principal.email,
    invitationTokenHash: principal.invitationTokenHash,
    userId: principal.userId,
  }
}

function requireInvitationToken(
  principal: CredentialGroupEnrollmentPrincipal,
  invitationToken: string
): void {
  if (!safeCompare(sha256Hex(invitationToken), principal.invitationTokenHash)) {
    throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  }
}

interface PublicEnrollmentContext extends PublicCredentialGroupEnrollmentIdentity {
  enrollment: NonNullable<Awaited<ReturnType<typeof getAuthorizedPublicCredentialGroupEnrollment>>>
}

async function resolvePublicEnrollmentContext(
  principal: CredentialGroupEnrollmentPrincipal,
  optionId?: string
): Promise<PublicEnrollmentContext> {
  const identity = identityFromPrincipal(principal)
  const enrollment = await getAuthorizedPublicCredentialGroupEnrollment(
    identity,
    optionId === undefined ? undefined : { optionId }
  )
  if (!enrollment) throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  return { ...identity, enrollment }
}

export const readPublicCredentialGroupEnrollment = defineAuthorizedCredentialGroupEnrollmentUseCase(
  {
    operation: credentialGroupEnrollmentOperations.read,
    resolveContext: ({
      principal,
      input,
    }: {
      principal: CredentialGroupEnrollmentPrincipal
      input: { optionId?: string }
    }) => resolvePublicEnrollmentContext(principal, input.optionId),
    async execute({ context, principal }) {
      const canSearch =
        !context.organizationId ||
        ((await getOrganizationSettingsAccess(context.organizationId, principal.userId)).isMember &&
          (await isKnowledgeMemberAccessAvailable({ organizationId: context.organizationId })))
      return { enrollment: context.enrollment, canSearch }
    },
  }
)

export const completePublicCredentialGroupEnrollment =
  defineAuthorizedCredentialGroupEnrollmentUseCase({
    operation: credentialGroupEnrollmentOperations.complete,
    resolveContext: ({ principal }) => resolvePublicEnrollmentContext(principal),
    async execute({ context }) {
      const completion = await completeAuthorizedCredentialGroupEnrollment(context)
      if (completion?.transitioned && context.organizationId) {
        await fireCredentialGroupTrigger({
          event: 'form_submitted',
          organizationId: context.organizationId,
          credentialGroupId: context.credentialGroupId,
          credentialGroupName: context.enrollment.credentialGroupName,
          enrollmentId: context.enrollmentId,
          email: context.email,
          enrollmentStatus: 'completed',
        })
      }
      return { completed: completion?.completed ?? null }
    },
  })

interface PublicCredentialGroupOAuthInput {
  invitationToken: string
  optionId: string
  returnTo?: 'search' | 'accounts'
}

interface PublicCredentialGroupOAuthContext extends PublicCredentialGroupEnrollmentIdentity {
  oauth: NonNullable<Awaited<ReturnType<typeof getAuthorizedCredentialGroupOAuthContext>>>
}

async function resolvePublicOAuthContext(
  principal: CredentialGroupEnrollmentPrincipal,
  optionId: string
): Promise<PublicCredentialGroupOAuthContext> {
  const identity = identityFromPrincipal(principal)
  const oauth = await getAuthorizedCredentialGroupOAuthContext(identity, optionId)
  if (!oauth) throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  return { ...identity, oauth }
}

export const startPublicCredentialGroupOAuth = defineAuthorizedCredentialGroupEnrollmentUseCase({
  operation: credentialGroupEnrollmentOperations.startOAuth,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: CredentialGroupEnrollmentPrincipal
    input: PublicCredentialGroupOAuthInput
  }) => resolvePublicOAuthContext(principal, input.optionId),
  async execute({ principal, input, context }) {
    requireInvitationToken(principal, input.invitationToken)
    return {
      authorizationUrl: await startCredentialGroupOAuth(context.oauth, input.invitationToken, {
        returnTo: input.returnTo,
      }),
    }
  },
})

interface CompletePublicCredentialGroupOAuthInput {
  attempt: CredentialGroupOAuthAttempt
  code: string
}

function identityForOAuthAttempt(
  principal: CredentialGroupEnrollmentPrincipal,
  attempt: Pick<
    CredentialGroupOAuthAttempt,
    | 'workspaceId'
    | 'organizationId'
    | 'credentialGroupId'
    | 'enrollmentId'
    | 'email'
    | 'invitationToken'
    | 'userId'
  >
): PublicCredentialGroupEnrollmentIdentity {
  requireInvitationToken(principal, attempt.invitationToken)
  if (
    !sameResourceScope(resourceScopeFromOwner(attempt), resourceScopeFromOwner(principal)) ||
    attempt.email !== principal.email ||
    attempt.credentialGroupId !== principal.credentialGroupId ||
    attempt.enrollmentId !== principal.enrollmentId ||
    attempt.userId !== principal.userId
  ) {
    throw new OrchestrationError('not_found', 'Authorization state does not match this enrollment')
  }
  return identityFromPrincipal(principal)
}

async function resolveOAuthAttemptContext(
  principal: CredentialGroupEnrollmentPrincipal,
  attempt: CredentialGroupOAuthAttempt
): Promise<PublicCredentialGroupOAuthContext> {
  const identity = identityForOAuthAttempt(principal, attempt)
  const oauth = await getCredentialGroupOAuthContextForEnrollment(identity, attempt.optionId)
  if (!oauth) throw new CredentialGroupInvitationUnavailableError()
  return { ...identity, oauth }
}

export const completePublicCredentialGroupOAuth = defineAuthorizedCredentialGroupEnrollmentUseCase({
  operation: credentialGroupEnrollmentOperations.completeOAuth,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: CredentialGroupEnrollmentPrincipal
    input: CompletePublicCredentialGroupOAuthInput
  }) => resolveOAuthAttemptContext(principal, input.attempt),
  async execute({ principal, input, context }) {
    requireInvitationToken(principal, input.attempt.invitationToken)
    const completion = await completeCredentialGroupOAuth(context.oauth, input.attempt, input.code)
    if (context.organizationId)
      await fireCredentialGroupTrigger({
        event: completion.created ? 'credential_added' : 'credential_reconnected',
        organizationId: context.organizationId,
        credentialGroupId: context.credentialGroupId,
        credentialGroupName: context.oauth.credentialGroupName,
        enrollmentId: context.enrollmentId,
        email: context.email,
        enrollmentStatus: completion.enrollmentStatus,
        credential: {
          credentialId: completion.credentialId,
          credentialGroupOptionId: completion.credentialGroupOptionId,
          provider: completion.provider,
          providerId: completion.providerId,
          displayName: completion.displayName,
        },
      })
    return { connectedOptionId: context.oauth.option.id }
  },
})

interface PublicCredentialGroupMcpOAuthInput {
  invitationToken: string
  mcpServerId: string
}

interface PublicCredentialGroupMcpOAuthContext extends PublicCredentialGroupEnrollmentIdentity {
  oauth: NonNullable<Awaited<ReturnType<typeof getAuthorizedCredentialGroupMcpOAuthContext>>>
}

async function resolvePublicMcpOAuthContext(
  principal: CredentialGroupEnrollmentPrincipal,
  mcpServerId: string
): Promise<PublicCredentialGroupMcpOAuthContext> {
  const identity = identityFromPrincipal(principal)
  const oauth = await getAuthorizedCredentialGroupMcpOAuthContext(identity, mcpServerId)
  if (!oauth) throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  return { ...identity, oauth }
}

export const startPublicCredentialGroupMcpOAuth = defineAuthorizedCredentialGroupEnrollmentUseCase({
  operation: credentialGroupEnrollmentOperations.startMcpOAuth,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: CredentialGroupEnrollmentPrincipal
    input: PublicCredentialGroupMcpOAuthInput
  }) => resolvePublicMcpOAuthContext(principal, input.mcpServerId),
  async execute({ principal, input, context }) {
    requireInvitationToken(principal, input.invitationToken)
    return {
      authorizationUrl: await startCredentialGroupMcpOAuth(context.oauth, input.invitationToken),
    }
  },
})

interface CompletePublicCredentialGroupMcpOAuthInput {
  attempt: CredentialGroupMcpOAuthAttempt
  code: string
}

export const completePublicCredentialGroupMcpOAuth =
  defineAuthorizedCredentialGroupEnrollmentUseCase({
    operation: credentialGroupEnrollmentOperations.completeMcpOAuth,
    async resolveContext({
      principal,
      input,
    }: {
      principal: CredentialGroupEnrollmentPrincipal
      input: CompletePublicCredentialGroupMcpOAuthInput
    }) {
      const identity = identityForOAuthAttempt(principal, input.attempt)
      const oauth = await getCredentialGroupMcpOAuthContextForEnrollment(
        identity,
        input.attempt.mcpServerId
      )
      if (!oauth) throw new CredentialGroupInvitationUnavailableError()
      if (oauth.server.oauthConfigVersion !== input.attempt.oauthConfigVersion)
        throw new OrchestrationError('conflict', 'MCP setup changed. Start authorization again.')
      return { ...identity, oauth }
    },
    async execute({ principal, input, context }) {
      requireInvitationToken(principal, input.attempt.invitationToken)
      const completion = await completeCredentialGroupMcpOAuth(
        context.oauth,
        input.attempt.codeVerifier,
        input.code,
        input.attempt.invitationToken
      )
      if (context.organizationId)
        await fireCredentialGroupTrigger({
          event: completion.created ? 'credential_added' : 'credential_reconnected',
          organizationId: context.organizationId,
          credentialGroupId: context.credentialGroupId,
          credentialGroupName: context.oauth.credentialGroupName,
          enrollmentId: context.enrollmentId,
          email: context.email,
          enrollmentStatus: completion.enrollmentStatus,
          credential: {
            credentialId: completion.connectionId,
            credentialGroupOptionId: null,
            mcpServerId: completion.mcpServerId,
            provider: context.oauth.server.connectorId,
            providerId: context.oauth.server.connectorId,
            displayName: context.oauth.server.name,
          },
        })
      return { connectionId: completion.connectionId, mcpServerId: completion.mcpServerId }
    },
  })
