import { db } from '@sim/db'
import { credentialGroupEnrollment, user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  authenticatePublicCredentialGroupEnrollment,
  bindCredentialGroupEnrollmentUser,
  CredentialGroupEnrollmentError,
  createCredentialGroupSelfEnrollmentLink,
} from '@/lib/credential-groups/enrollments'

/** Enrolls a verified workspace member without reviving access revoked by an administrator. */
export async function createViewerCredentialGroupEnrollment(input: {
  userId: string
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
}) {
  const [viewer] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  if (!viewer) throw new OrchestrationError('not_found', 'User not found')
  if (!viewer.emailVerified) {
    throw new OrchestrationError(
      'validation',
      'Verify your email address before connecting an account'
    )
  }
  const [boundEnrollment] = await db
    .select({ email: credentialGroupEnrollment.email })
    .from(credentialGroupEnrollment)
    .where(
      and(
        eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId),
        eq(credentialGroupEnrollment.userId, input.userId)
      )
    )
    .limit(1)
  const email = boundEnrollment?.email ?? normalizeEmail(viewer.email)
  const revoked = new OrchestrationError(
    'forbidden',
    'An admin removed your access to Connected accounts'
  )
  if (await isEnrollmentRevoked(input.credentialGroupId, email)) throw revoked
  try {
    const result = await createCredentialGroupSelfEnrollmentLink(
      resourceScopeFromOwner(input),
      input.credentialGroupId,
      email
    )
    const token = new URL(result.invitationLink).pathname.split('/').at(-1)
    if (!token) throw new Error('Enrollment link is missing its token')
    const identity = await authenticatePublicCredentialGroupEnrollment(token)
    if (!identity) throw new Error('Enrollment is no longer available')
    await bindCredentialGroupEnrollmentUser(identity, input.userId)
    return result
  } catch (error) {
    /** The issue refused a revocation that landed after the read above; report it as such. */
    if (
      error instanceof CredentialGroupEnrollmentError &&
      error.status === 409 &&
      (await isEnrollmentRevoked(input.credentialGroupId, email))
    ) {
      throw revoked
    }
    throw error
  }
}

async function isEnrollmentRevoked(credentialGroupId: string, email: string): Promise<boolean> {
  const [enrollment] = await db
    .select({ status: credentialGroupEnrollment.status })
    .from(credentialGroupEnrollment)
    .where(
      and(
        eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
        eq(credentialGroupEnrollment.email, email)
      )
    )
    .limit(1)
  return enrollment?.status === 'revoked'
}
