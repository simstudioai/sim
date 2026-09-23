import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getCredentialGroupOAuthContextForEnrollment } from '@/lib/credential-groups/enrollments'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import type { CredentialGroupConnectionIntent } from '@/lib/credential-groups/oauth-intent'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'

/** Starts a user-initiated connection with the same scoped receipt for live and indexed Search. */
export async function startViewerCredentialGroupOAuth(input: {
  userId: string
  organizationId?: string
  workspaceId?: string
  credentialGroupId: string
  optionId: string
  completionId: string
  connectionIntent?: CredentialGroupConnectionIntent
}): Promise<{ invitationLink: string; authorizationUrl: string }> {
  const { enrollment, invitationLink } = await createViewerCredentialGroupEnrollment(input)
  const token = new URL(invitationLink).pathname.split('/').at(-1)
  if (!token) throw new Error('Account enrollment did not return an invitation token')
  const oauth = await getCredentialGroupOAuthContextForEnrollment(
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      credentialGroupId: input.credentialGroupId,
      enrollmentId: enrollment.id,
      email: enrollment.email,
      userId: input.userId,
    },
    input.optionId
  )
  if (!oauth)
    throw new OrchestrationError('forbidden', 'This account connection is no longer available')
  const authorizationUrl = await startCredentialGroupOAuth(oauth, token, {
    completionRedirect: true,
    returnTo: 'search',
    completionId: input.completionId,
    connectionIntent: input.connectionIntent,
  })
  return { invitationLink, authorizationUrl }
}
