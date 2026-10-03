import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getCredentialGroupMcpOAuthContextForEnrollment,
  getCredentialGroupOAuthContextForEnrollment,
} from '@/lib/credential-groups/enrollments'
import { startCredentialGroupMcpOAuth } from '@/lib/credential-groups/mcp-oauth'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import type { CredentialGroupConnectionIntent } from '@/lib/credential-groups/oauth-intent'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'

/** Starts a user-initiated connection with a scoped receipt for Search and knowledge-base enrollment. */
export async function startViewerCredentialGroupOAuth(input: {
  userId: string
  organizationId?: string
  workspaceId?: string
  credentialGroupId: string
  optionId: string
  completionId: string
  returnTo?: 'integrations'
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
    returnTo: input.returnTo ?? 'search',
    completionId: input.completionId,
    connectionIntent: input.connectionIntent,
  })
  return { invitationLink, authorizationUrl }
}

/** Starts one managed MCP account without turning the connection into an invitation submission. */
export async function startViewerCredentialGroupMcpOAuth(input: {
  userId: string
  organizationId: string
  credentialGroupId: string
  mcpServerId: string
  completionId: string
  returnTo?: 'integrations'
}): Promise<{ invitationLink: string; authorizationUrl: string }> {
  const { enrollment, invitationLink } = await createViewerCredentialGroupEnrollment(input)
  const token = new URL(invitationLink).pathname.split('/').at(-1)
  if (!token) throw new Error('Account enrollment did not return an invitation token')
  const oauth = await getCredentialGroupMcpOAuthContextForEnrollment(
    {
      organizationId: input.organizationId,
      credentialGroupId: input.credentialGroupId,
      enrollmentId: enrollment.id,
      email: enrollment.email,
      userId: input.userId,
    },
    input.mcpServerId
  )
  if (!oauth)
    throw new OrchestrationError('forbidden', 'This account connection is no longer available')
  const authorizationUrl = await startCredentialGroupMcpOAuth(oauth, token, {
    completionId: input.completionId,
    returnTo: input.returnTo,
  })
  return { invitationLink, authorizationUrl }
}
