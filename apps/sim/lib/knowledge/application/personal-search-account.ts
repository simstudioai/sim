import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { isOAuthServiceDeploymentAvailable } from '@/lib/integrations/availability.server'
import { requireKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { requireOrganizationSearchApproval } from '@/lib/knowledge/search/integration-policy'

export type PersonalSearchSetupConnector = 'jira' | 'confluence'

/** Rechecks the caller's organization and approved integration before personal account discovery. */
export async function authorizePersonalSearchSetup(
  principal: Principal,
  input: { organizationId: string; connectorType: PersonalSearchSetupConnector }
) {
  if (
    principal.kind !== 'session' ||
    (input.connectorType !== 'jira' && input.connectorType !== 'confluence')
  ) {
    throw new OrchestrationError('forbidden', 'Sign in to connect this Search source')
  }
  await requireOrganizationMembership(principal, input.organizationId, 'member', 'knowledge.use')
  const [viewer] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, principal.userId))
    .limit(1)
  if (!viewer?.emailVerified) {
    throw new OrchestrationError(
      'validation',
      'Verify your email address before connecting an account'
    )
  }
  await requireOrganizationSearchApproval(input.organizationId, input.connectorType)
  await requireKnowledgeMemberAccessAvailable({ organizationId: input.organizationId })
  if (!isOAuthServiceDeploymentAvailable(input.connectorType)) {
    throw new OrchestrationError('validation', 'This account connection is unavailable')
  }
  return principal.userId
}

/** Personal setup can browse only a currently live grant owned by the signed-in member. */
export async function authorizePersonalSearchSetupCredential(
  principal: Principal,
  input: {
    organizationId: string
    connectorType: PersonalSearchSetupConnector
    credentialId: string
  }
) {
  const userId = await authorizePersonalSearchSetup(principal, input)
  const accounts = await getOwnOrganizationManagedOAuthCredentials({
    organizationId: input.organizationId,
    userId,
    providerId: input.connectorType,
    credentialId: input.credentialId,
  })
  const account = accounts.find(
    (entry) => entry.id === input.credentialId && entry.providerId === input.connectorType
  )
  if (!account) {
    throw new OrchestrationError('not_found', 'Connect your account again before choosing sources')
  }
  return account
}
