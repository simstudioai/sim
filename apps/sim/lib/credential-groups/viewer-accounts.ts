import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT } from '@/lib/credential-groups/api-key-constants'
import { ORGANIZATION_VIEWER_ACCOUNT_LIMIT } from '@/lib/credential-groups/limits'

/** Own grant metadata remains manageable even while provider setup or enrollment is disabled. */
export async function listViewerOrganizationAccounts(input: {
  organizationId: string
  userId: string
  matching: SQL
}) {
  const scope = { kind: 'organization', organizationId: input.organizationId } as const
  const accounts = await db
    .select({
      credentialId: credential.id,
      displayName: credential.displayName,
      status: credential.managedOauthStatus,
      groupId: credentialGroup.id,
      optionId: credential.credentialGroupOptionId,
      providerId: credential.providerId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        resourceScopeCondition(credential, scope),
        resourceScopeCondition(credentialGroup, scope),
        eq(credentialGroupEnrollment.userId, input.userId),
        eq(credential.type, 'managed_oauth'),
        inArray(credential.managedOauthStatus, ['active', 'needs_reauth']),
        isNull(credential.revokedAt),
        input.matching
      )
    )
    .limit(ORGANIZATION_VIEWER_ACCOUNT_LIMIT + 1)
  if (accounts.length > ORGANIZATION_VIEWER_ACCOUNT_LIMIT)
    throw new Error('Too many personal accounts for this organization')
  return accounts.map((account) => {
    if (
      !account.optionId ||
      !account.providerId ||
      (account.status !== 'active' && account.status !== 'needs_reauth')
    )
      throw new Error('Invalid personal account metadata')
    return {
      ...account,
      optionId: account.optionId,
      providerId: account.providerId,
      status: account.status,
    }
  })
}

/** Lists only the acting member's submitted API-key identities, never ciphertext. */
export async function listViewerOrganizationApiKeys(input: {
  organizationId: string
  credentialGroupId: string
  userId: string
}) {
  const rows = await db
    .select({
      credentialId: credential.id,
      optionId: credential.credentialGroupOptionId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .where(
      and(
        eq(credential.organizationId, input.organizationId),
        eq(credential.type, 'managed_api_key'),
        eq(credential.managedOauthStatus, 'active'),
        isNull(credential.revokedAt),
        eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId),
        eq(credentialGroupEnrollment.userId, input.userId),
        isNull(credentialGroupEnrollment.revokedAt)
      )
    )
    .limit(CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT + 1)
  if (rows.length > CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT)
    throw new Error('Too many personal API keys for this organization')
  return rows.map((row) => {
    if (!row.optionId) throw new Error('API-key credential has no request identity')
    return { credentialId: row.credentialId, optionId: row.optionId }
  })
}
