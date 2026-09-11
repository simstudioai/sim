import { credential, credentialGroup } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { listViewerOrganizationAccounts } from '@/lib/credential-groups/viewer-accounts'
import { getConnectorMeta } from '@/connectors/registry'

interface ViewerSourceAccount {
  credentialId: string
  displayName: string
  status: 'active' | 'needs_reauth'
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
  const accounts = await listViewerOrganizationAccounts({
    organizationId: input.organizationId,
    userId: input.userId,
    matching: or(...matches)!,
  })
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
        own.map(({ credentialId, displayName, status }) => {
          if (status !== 'active' && status !== 'needs_reauth')
            throw new Error('Invalid personal account status')
          return { credentialId, displayName, status }
        })
      )
  }
  return result
}
