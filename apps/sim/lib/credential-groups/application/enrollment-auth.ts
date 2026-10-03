import type { CredentialGroupEnrollmentPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { getSession } from '@/lib/auth'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { authenticatePublicCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'

/** Exchanges a valid invitation bearer for its bounded external enrollment principal. */
export async function authenticateCredentialGroupEnrollment(
  invitationToken: string
): Promise<CredentialGroupEnrollmentPrincipal | null> {
  if (!invitationToken.trim() || invitationToken.length > 128) return null
  const session = await getSession()
  if (!session?.user?.id || !session.user.emailVerified) return null
  const identity = await authenticatePublicCredentialGroupEnrollment(invitationToken)
  if (!identity) return null
  if (identity.userId && identity.userId !== session.user.id) return null
  return Object.freeze({
    kind: 'credential_group_enrollment' as const,
    userId: session.user.id,
    ...resourceScopeFields(resourceScopeFromOwner(identity)),
    credentialGroupId: identity.credentialGroupId,
    enrollmentId: identity.enrollmentId,
    email: identity.email,
    invitationTokenHash: identity.invitationTokenHash,
  })
}

/** A consumed one-time attempt retains only its original enrollment authority, never a rotated invitation. */
export async function credentialGroupOAuthAttemptPrincipal(
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
): Promise<CredentialGroupEnrollmentPrincipal> {
  const session = await getSession()
  if (!attempt.userId || !session?.user?.emailVerified || session.user.id !== attempt.userId) {
    throw new OrchestrationError(
      'forbidden',
      'Complete authorization using the same signed-in account that started it'
    )
  }
  return Object.freeze({
    kind: 'credential_group_enrollment',
    userId: session.user.id,
    ...resourceScopeFields(resourceScopeFromOwner(attempt)),
    credentialGroupId: attempt.credentialGroupId,
    enrollmentId: attempt.enrollmentId,
    email: attempt.email,
    invitationTokenHash: sha256Hex(attempt.invitationToken),
  })
}
