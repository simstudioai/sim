import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, user } from '@sim/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import { getCredentialGroupProviderId } from '@/lib/credential-groups/providers'

/**
 * The Slack account a federated search runs as: the asking person's own,
 * enrolled through a Credential Group in this workspace.
 *
 * Deliberately does not filter on `managedOauthStatus`. A credential that needs
 * authorizing again is still a connection the person made, and the difference
 * between "you never connected Slack" and "reconnect Slack" is the whole of
 * what the surface can tell them to do. Excluding it here would collapse the
 * second into the first — which is exactly what a scope-policy change does to
 * every enrolled credential at once. `resolveManagedOAuthToken` classifies it,
 * and an active credential is preferred when a person somehow holds several.
 *
 * The group must belong to this workspace as well as the credential: the two
 * are set together today, and requiring both keeps a workspace's search inside
 * its own groups even if they ever diverge.
 */
export async function findViewerSlackCredentialId(params: {
  workspaceId: string
  userId: string
}): Promise<string | null> {
  const [row] = await db
    .select({ credentialId: credential.id })
    .from(user)
    .innerJoin(
      credentialGroupEnrollment,
      and(
        eq(
          credentialGroupEnrollment.email,
          sql`COALESCE(${user.normalizedEmail}, lower(btrim(${user.email})))`
        ),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES])
      )
    )
    .innerJoin(
      credentialGroup,
      and(
        eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId),
        eq(credentialGroup.workspaceId, params.workspaceId),
        eq(credentialGroup.status, 'active')
      )
    )
    .innerJoin(
      credential,
      and(
        eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id),
        eq(credential.workspaceId, params.workspaceId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.providerId, getCredentialGroupProviderId('slack')),
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
          WHERE option->>'id' = ${credential.credentialGroupOptionId}
            AND option->>'status' = 'active'
        )`
      )
    )
    .where(and(eq(user.id, params.userId), eq(user.emailVerified, true)))
    .orderBy(sql`CASE WHEN ${credential.managedOauthStatus} = 'active' THEN 0 ELSE 1 END`)
    .limit(1)

  return row?.credentialId ?? null
}
