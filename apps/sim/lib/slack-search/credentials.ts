import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, user } from '@sim/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import { getCredentialGroupProviderId } from '@/lib/credential-groups/providers'

/**
 * The Slack account a federated search runs as: the asking person's own,
 * enrolled through a Credential Group in this workspace.
 *
 * The joins mirror the knowledge access scope exactly — verified email, live
 * enrollment, active group, active managed credential, active option — because
 * both answer the same question about the same rows, and a search that used a
 * looser rule than the one governing document access would be the odd one out.
 * Nothing is cached: revoking a credential takes effect on the next search.
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
        eq(credentialGroup.status, 'active')
      )
    )
    .innerJoin(
      credential,
      and(
        eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id),
        eq(credential.workspaceId, params.workspaceId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.managedOauthStatus, 'active'),
        eq(credential.providerId, getCredentialGroupProviderId('slack')),
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
          WHERE option->>'id' = ${credential.credentialGroupOptionId}
            AND option->>'status' = 'active'
        )`
      )
    )
    .where(and(eq(user.id, params.userId), eq(user.emailVerified, true)))
    .limit(1)

  return row?.credentialId ?? null
}
