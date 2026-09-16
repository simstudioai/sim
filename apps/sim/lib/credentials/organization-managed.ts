import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, user } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import {
  resourceScopeCondition,
  sameResourceScopeCondition,
} from '@/lib/core/resource-scope.server'
import { isManagedCredentialGroupBindingLive } from '@/lib/credential-groups/credentials'

/** Lists only a verified person's currently usable organization grants, without token material. */
export async function getOwnOrganizationManagedOAuthCredentials(input: {
  organizationId: string
  userId: string
  providerId?: string
  credentialId?: string
}) {
  const rows = await db
    .select({
      id: credential.id,
      displayName: credential.displayName,
      providerId: credential.providerId,
      grantedScopes: credential.grantedScopes,
      managedOauthStatus: credential.managedOauthStatus,
      optionId: credential.credentialGroupOptionId,
      enrollmentStatus: credentialGroupEnrollment.status,
      groupStatus: credentialGroup.status,
      options: credentialGroup.options,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(user, eq(user.id, credentialGroupEnrollment.userId))
    .where(
      and(
        resourceScopeCondition(credential, {
          kind: 'organization',
          organizationId: input.organizationId,
        }),
        sameResourceScopeCondition(credential, credentialGroup),
        eq(credential.type, 'managed_oauth'),
        eq(credential.createdBy, input.userId),
        eq(user.id, input.userId),
        eq(user.emailVerified, true),
        input.providerId ? eq(credential.providerId, input.providerId) : undefined,
        input.credentialId ? eq(credential.id, input.credentialId) : undefined
      )
    )
    .orderBy(desc(credential.createdAt))
    .limit(input.credentialId ? 1 : 1000)

  return rows.flatMap((row) =>
    row.providerId &&
    row.managedOauthStatus &&
    isManagedCredentialGroupBindingLive({
      managedOauthStatus: row.managedOauthStatus,
      enrollmentStatus: row.enrollmentStatus,
      groupStatus: row.groupStatus,
      optionStatus: row.options.find((option) => option.id === row.optionId)?.status ?? null,
    })
      ? [
          {
            id: row.id,
            displayName: row.displayName,
            providerId: row.providerId,
            scopes: row.grantedScopes ?? [],
          },
        ]
      : []
  )
}
