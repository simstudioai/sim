import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  user,
} from '@sim/db/schema'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'

export class SlackSearchIdentityError extends Error {
  constructor(
    readonly reason:
      | 'account_required'
      | 'verify_email'
      | 'membership_required'
      | 'identity_conflict' = 'account_required'
  ) {
    super(
      'Your Slack email must match one verified Sim account that belongs to this organization. Ask your administrator to check your account.'
    )
    this.name = 'SlackSearchIdentityError'
  }
}

/** Beyond one person's accounts, every further row is another person's claim: already a conflict. */
const LINKED_IDENTITY_SCAN_LIMIT = 50

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
  if (users.length > 1) throw new SlackSearchIdentityError('identity_conflict')
  if (users.length === 0) throw new SlackSearchIdentityError('account_required')
  if (!users[0].emailVerified) throw new SlackSearchIdentityError('verify_email')
  const userId = users[0].id
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  if (!membership) throw new SlackSearchIdentityError('membership_required')
  const linked = await db
    .select({ subjectId: credential.providerSubjectId, userId: credentialGroupEnrollment.userId })
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
        or(
          eq(credential.providerSubjectId, slackUserId),
          eq(credentialGroupEnrollment.userId, userId)
        )
      )
    )
    .limit(LINKED_IDENTITY_SCAN_LIMIT)
  const own = linked.filter((row) => row.userId === userId)
  if (
    linked.some((row) => row.subjectId === slackUserId && row.userId !== userId) ||
    (own.length > 0 && !own.some((row) => row.subjectId === slackUserId))
  )
    throw new SlackSearchIdentityError('identity_conflict')
  return userId
}
