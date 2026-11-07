import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  type ManagedOAuthSite,
} from '@sim/db/schema'
import { toArray, toRecord } from '@sim/utils/object'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { ORGANIZATION_VIEWER_ACCOUNT_LIMIT } from '@/lib/credential-groups/limits'

/** Stored metadata is provider-shaped JSON, so only well-formed entries are shown. */
function recordedSites(metadata: unknown): ManagedOAuthSite[] {
  return toArray(toRecord(metadata).sites).flatMap((entry) => {
    const site = toRecord(entry)
    return typeof site.name === 'string' && typeof site.url === 'string'
      ? [{ name: site.name, url: site.url }]
      : []
  })
}

/** Own grant metadata remains manageable even while provider setup or enrollment is disabled. */
export async function listViewerOrganizationAccounts(input: {
  organizationId: string
  userId: string
  matching?: SQL
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
      metadata: credential.providerMetadata,
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
    const { metadata, ...rest } = account
    return {
      ...rest,
      optionId: account.optionId,
      providerId: account.providerId,
      status: account.status,
      sites: recordedSites(metadata),
    }
  })
}

/** Own grant metadata remains manageable even while provider setup or enrollment is disabled. */
export async function listViewerOrganizationMcpAccounts(input: {
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
      mcpServerId: credential.mcpServerId,
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
        eq(credential.type, 'managed_mcp'),
        inArray(credential.managedOauthStatus, ['active', 'needs_reauth']),
        isNull(credential.revokedAt),
        input.matching
      )
    )
    .limit(ORGANIZATION_VIEWER_ACCOUNT_LIMIT + 1)
  if (accounts.length > ORGANIZATION_VIEWER_ACCOUNT_LIMIT)
    throw new Error('Too many personal accounts for this organization')
  return accounts.map((account) => {
    if (!account.mcpServerId || (account.status !== 'active' && account.status !== 'needs_reauth'))
      throw new Error('Invalid personal account metadata')
    return {
      ...account,
      mcpServerId: account.mcpServerId,
      status: account.status,
    }
  })
}
