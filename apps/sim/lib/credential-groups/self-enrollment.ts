import { db } from '@sim/db'
import { credentialGroupEnrollment, user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CredentialGroupEnrollmentError,
  createCredentialGroupSelfEnrollmentLink,
} from '@/lib/credential-groups/enrollments'

/** Enrolls a verified workspace member without reviving access revoked by an administrator. */
export async function createViewerCredentialGroupEnrollment(input: {
  userId: string
  workspaceId: string
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
  const email = normalizeEmail(viewer.email)
  const revoked = new OrchestrationError(
    'forbidden',
    'A workspace admin removed your access to Connected accounts'
  )
  if (await isEnrollmentRevoked(input.credentialGroupId, email)) throw revoked
  try {
    return await createCredentialGroupSelfEnrollmentLink(
      input.workspaceId,
      input.credentialGroupId,
      email
    )
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
