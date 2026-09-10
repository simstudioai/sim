import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { SEARCH_SOURCE_CANDIDATE_PAGE_SIZE } from '@/lib/knowledge/constants'
import { getConnectorMeta } from '@/connectors/registry'

interface ViewerSourceAccount {
  credentialId: string
  displayName: string
}

interface SourceAccountBinding {
  id: string
  connectorType: string
  accessMode: string
  credentialGroupId: string | null
  credentialGroupOptionId: string | null
}

/**
 * Own account controls remain available when provider setup, enrollment, or sync is disabled.
 * Called inside the authorized source read; selects no token material or other contributors.
 */
export async function resolveViewerSourceAccounts(input: {
  organizationId: string
  userId: string
  connectors: ReadonlyArray<SourceAccountBinding>
}): Promise<Map<string, ViewerSourceAccount[]>> {
  const bindings = input.connectors.map((source) => {
    const meta = getConnectorMeta(source.connectorType)
    const providerId =
      source.accessMode === 'admin' && meta?.requiresMemberIdentity && meta.auth.mode === 'oauth'
        ? meta.auth.provider
        : null
    return { source, providerId }
  })
  const matches = bindings.flatMap(({ source, providerId }) => {
    if (
      source.accessMode === 'members' &&
      source.credentialGroupId &&
      source.credentialGroupOptionId
    )
      return [
        and(
          eq(credentialGroup.id, source.credentialGroupId),
          eq(credential.credentialGroupOptionId, source.credentialGroupOptionId)
        ),
      ]
    return providerId ? [eq(credential.providerId, providerId)] : []
  })
  const result = new Map<string, ViewerSourceAccount[]>()
  if (!matches.length) return result
  const scope = { kind: 'organization', organizationId: input.organizationId } as const
  const accounts = await db
    .select({
      credentialId: credential.id,
      displayName: credential.displayName,
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
        or(...matches)
      )
    )
    .limit(SEARCH_SOURCE_CANDIDATE_PAGE_SIZE + 1)
  if (accounts.length > SEARCH_SOURCE_CANDIDATE_PAGE_SIZE)
    throw new Error('Too many personal accounts for the source page')
  for (const { source, providerId } of bindings) {
    const own = accounts.filter((account) =>
      source.accessMode === 'members'
        ? account.groupId === source.credentialGroupId &&
          account.optionId === source.credentialGroupOptionId
        : providerId !== null && account.providerId === providerId
    )
    if (own.length)
      result.set(
        source.id,
        own.map(({ credentialId, displayName }) => ({ credentialId, displayName }))
      )
  }
  return result
}
