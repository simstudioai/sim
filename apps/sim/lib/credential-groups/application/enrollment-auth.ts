import type { CredentialGroupEnrollmentPrincipal } from '@sim/auth/principal'
import { authenticatePublicCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'

/** Exchanges a valid invitation bearer for its bounded external enrollment principal. */
export async function authenticateCredentialGroupEnrollment(
  invitationToken: string
): Promise<CredentialGroupEnrollmentPrincipal | null> {
  if (!invitationToken.trim() || invitationToken.length > 128) return null
  const identity = await authenticatePublicCredentialGroupEnrollment(invitationToken)
  if (!identity) return null
  return Object.freeze({ kind: 'credential_group_enrollment' as const, ...identity })
}
