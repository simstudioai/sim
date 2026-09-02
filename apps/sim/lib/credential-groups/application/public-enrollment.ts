import type { CredentialGroupEnrollmentPrincipal, Principal } from '@sim/auth/principal'
import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupEnrollmentOperations } from '@/lib/credential-groups/application/enrollment-operations'
import {
  completeAuthorizedCredentialGroupEnrollment,
  getAuthorizedCredentialGroupOAuthContext,
  getAuthorizedPublicCredentialGroupEnrollment,
  type PublicCredentialGroupEnrollmentIdentity,
} from '@/lib/credential-groups/enrollments'
import {
  completeCredentialGroupOAuth,
  startCredentialGroupOAuth,
} from '@/lib/credential-groups/oauth'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { fireCredentialGroupTrigger } from '@/lib/credential-groups/trigger'

interface AuthorizedCredentialGroupEnrollmentUseCaseDefinition<O, I, C, R> {
  operation: O
  resolveContext(args: { principal: CredentialGroupEnrollmentPrincipal; input: I }): Promise<C>
  execute(args: { principal: CredentialGroupEnrollmentPrincipal; input: I; context: C }): Promise<R>
}

function requireCredentialGroupEnrollmentPrincipal(
  principal: Principal
): asserts principal is CredentialGroupEnrollmentPrincipal {
  if (principal.kind !== 'credential_group_enrollment') {
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
    context.workspaceId !== principal.workspaceId ||
    context.credentialGroupId !== principal.credentialGroupId ||
    context.enrollmentId !== principal.enrollmentId ||
    context.email !== principal.email ||
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
    workspaceId: principal.workspaceId,
    credentialGroupId: principal.credentialGroupId,
    enrollmentId: principal.enrollmentId,
    email: principal.email,
    invitationTokenHash: principal.invitationTokenHash,
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
  principal: CredentialGroupEnrollmentPrincipal
): Promise<PublicEnrollmentContext> {
  const identity = identityFromPrincipal(principal)
  const enrollment = await getAuthorizedPublicCredentialGroupEnrollment(identity)
  if (!enrollment) throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  return { ...identity, enrollment }
}

export const readPublicCredentialGroupEnrollment = defineAuthorizedCredentialGroupEnrollmentUseCase(
  {
    operation: credentialGroupEnrollmentOperations.read,
    resolveContext: ({ principal }) => resolvePublicEnrollmentContext(principal),
    async execute({ context }) {
      return { enrollment: context.enrollment }
    },
  }
)

export const completePublicCredentialGroupEnrollment =
  defineAuthorizedCredentialGroupEnrollmentUseCase({
    operation: credentialGroupEnrollmentOperations.complete,
    resolveContext: ({ principal }) => resolvePublicEnrollmentContext(principal),
    async execute({ context }) {
      const completion = await completeAuthorizedCredentialGroupEnrollment(context)
      if (completion?.transitioned) {
        await fireCredentialGroupTrigger({
          event: 'form_submitted',
          workspaceId: context.workspaceId,
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
      authorizationUrl: await startCredentialGroupOAuth(context.oauth, input.invitationToken),
    }
  },
})

interface CompletePublicCredentialGroupOAuthInput {
  attempt: CredentialGroupOAuthAttempt
  code: string
}

export const completePublicCredentialGroupOAuth = defineAuthorizedCredentialGroupEnrollmentUseCase({
  operation: credentialGroupEnrollmentOperations.completeOAuth,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: CredentialGroupEnrollmentPrincipal
    input: CompletePublicCredentialGroupOAuthInput
  }) => resolvePublicOAuthContext(principal, input.attempt.optionId),
  async execute({ principal, input, context }) {
    requireInvitationToken(principal, input.attempt.invitationToken)
    const completion = await completeCredentialGroupOAuth(context.oauth, input.attempt, input.code)
    await fireCredentialGroupTrigger({
      event: completion.created ? 'credential_added' : 'credential_reconnected',
      workspaceId: context.workspaceId,
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
