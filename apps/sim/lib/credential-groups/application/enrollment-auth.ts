import type { CredentialGroupEnrollmentPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { authenticatePublicCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'

/** Exchanges a valid invitation bearer for its bounded external enrollment principal. */
export async function authenticateCredentialGroupEnrollment(
  invitationToken: string
): Promise<CredentialGroupEnrollmentPrincipal | null> {
  if (!invitationToken.trim() || invitationToken.length > 128) return null
  const identity = await authenticatePublicCredentialGroupEnrollment(invitationToken)
  if (!identity) return null
  return Object.freeze({ kind: 'credential_group_enrollment' as const, ...identity })
}

/** A consumed one-time attempt retains only its original enrollment authority, never a rotated invitation. */
export function credentialGroupOAuthAttemptPrincipal(
  attempt: Pick<
    CredentialGroupOAuthAttempt,
    'workspaceId' | 'credentialGroupId' | 'enrollmentId' | 'email' | 'invitationToken'
  >
): CredentialGroupEnrollmentPrincipal {
  return Object.freeze({
    kind: 'credential_group_enrollment',
    workspaceId: attempt.workspaceId,
    credentialGroupId: attempt.credentialGroupId,
    enrollmentId: attempt.enrollmentId,
    email: attempt.email,
    invitationTokenHash: sha256Hex(attempt.invitationToken),
  })
}
