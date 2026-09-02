/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getManagedOAuthConnectorPolicy } from '@/lib/auth/connectors/managed-oauth'
import {
  getCredentialGroupProviderService,
  getCredentialGroupStandardOAuthProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const permissionScoped = Object.values(CONNECTOR_META_REGISTRY).filter(
  (meta) => meta.permissionScopedListing !== undefined
)

/**
 * A connector that crawls per member mints each member's token from a
 * Credential Group option, and that option requests exactly the scopes its
 * provider's managed policy defines. The connector's own read scopes must fit
 * inside them, or every member would be refused at sync time with no way to
 * fix it from the connector's settings.
 */
describe('permission-scoped connector listings', () => {
  it('covers the connectors that crawl per member', () => {
    expect(permissionScoped.map((meta) => meta.id).sort()).toEqual(['confluence', 'google_drive'])
  })

  it.each(permissionScoped.map((meta) => [meta.id, meta] as const))(
    '%s authenticates through a managed OAuth provider whose option scopes cover its read scopes',
    (_id, meta) => {
      expect(meta.auth.mode).toBe('oauth')
      if (meta.auth.mode !== 'oauth') return

      const policy = getManagedOAuthConnectorPolicy(meta.auth.provider)
      expect(policy).toBeDefined()
      if (!policy) return

      const groupProvider = getCredentialGroupStandardOAuthProviderFromProviderId(
        meta.auth.provider
      )
      expect(groupProvider).toBeDefined()

      const optionScopes = [
        ...new Set([
          ...getCredentialGroupProviderService(groupProvider).scopes,
          ...policy.additionalScopes,
        ]),
      ]
      expect(policy.hasRequiredScopes(optionScopes, meta.auth.requiredScopes ?? [])).toBe(true)
    }
  )

  it.each(permissionScoped.map((meta) => [meta.id, meta] as const))(
    '%s names only real config fields as listing caps',
    (_id, meta) => {
      const fieldIds = new Set(meta.configFields.map((field) => field.id))
      for (const capFieldId of meta.permissionScopedListing?.capFieldIds ?? []) {
        expect(fieldIds.has(capFieldId)).toBe(true)
      }
    }
  )
})
