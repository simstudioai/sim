import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  user,
} from '@sim/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'

export class SlackSearchIdentityError extends Error {
  constructor() {
    super(
      'Your Slack email must match one verified Sim account that belongs to this organization. Ask your administrator to check your account.'
    )
    this.name = 'SlackSearchIdentityError'
  }
}

/** Email matching never creates membership and refuses global email collisions or conflicting linked identities. */
export async function resolveSlackSearchMember(
  organizationId: string,
  teamId: string,
  slackUserId: string,
  email: string
) {
  const users = await db
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(sql`lower(btrim(${user.email})) = ${email}`)
    .limit(2)
  if (users.length !== 1 || !users[0].emailVerified) throw new SlackSearchIdentityError()
  const userId = users[0].id
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  if (!membership) throw new SlackSearchIdentityError()
  const conflicts = await db
    .select({ id: credential.id })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id)
    )
    .innerJoin(credentialGroup, eq(credentialGroupEnrollment.credentialGroupId, credentialGroup.id))
    .where(
      and(
        eq(credential.organizationId, organizationId),
        eq(credentialGroup.organizationId, organizationId),
        eq(credentialGroup.status, 'active'),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        eq(credential.type, 'managed_oauth'),
        eq(credential.providerId, 'slack'),
        eq(credential.managedOauthStatus, 'active'),
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
          WHERE option->>'id' = ${credential.credentialGroupOptionId}
            AND option->>'status' = 'active'
        )`,
        eq(credential.providerTenantId, teamId),
        sql`((${credential.providerSubjectId} = ${slackUserId} AND ${credentialGroupEnrollment.userId} IS DISTINCT FROM ${userId}) OR (${credentialGroupEnrollment.userId} = ${userId} AND ${credential.providerSubjectId} IS DISTINCT FROM ${slackUserId}))`
      )
    )
    .limit(1)
  if (conflicts.length) throw new SlackSearchIdentityError()
  return userId
}
