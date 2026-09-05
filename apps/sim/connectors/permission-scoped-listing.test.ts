/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getManagedOAuthConnectorPolicy } from '@/lib/auth/connectors/managed-oauth'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderService,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

/**
 * The scopes an option of the provider requests from every member: the
 * provider's service scopes plus its managed policy's additions for a standard
 * OAuth provider, and the fixed user-token policy for Slack.
 */
function optionScopesFor(provider: CredentialGroupProvider): string[] {
  if (!isCredentialGroupStandardOAuthProvider(provider)) return [...SLACK_MANAGED_USER_SCOPES]
  const service = getCredentialGroupProviderService(provider)
  const policy = getManagedOAuthConnectorPolicy(service.providerId)
  expect(policy).toBeDefined()
  return [...new Set([...service.scopes, ...(policy?.additionalScopes ?? [])])]
}

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
  it('offers Search only for reviewed source and permission capabilities', () => {
    const search = Object.values(CONNECTOR_META_REGISTRY).filter((meta) => meta.search)
    expect(search.map((meta) => meta.id).sort()).toEqual([
      'confluence',
      'github',
      'gitlab',
      'gmail',
      'google_calendar',
      'google_drive',
      'jira',
      'slack',
    ])
    for (const meta of search) {
      expect(Boolean(meta.permissionScopedListing) || meta.mirrorsSourceAcls === true).toBe(true)
      if (meta.auth.mode === 'apiKey') expect(meta.mirrorsSourceAcls).toBe(true)
      if (meta.supportsSeparateContentCredential) expect(meta.permissionScopedListing).toBeDefined()
    }
  })

  it('covers the connectors that crawl per member', () => {
    expect(permissionScoped.map((meta) => meta.id).sort()).toEqual([
      'airtable',
      'asana',
      'bitbucket',
      'box',
      'clickup',
      'confluence',
      'docusign',
      'dropbox',
      'github',
      'gmail',
      'google_calendar',
      'google_chat',
      'google_docs',
      'google_drive',
      'google_forms',
      'google_meet',
      'google_sheets',
      'google_slides',
      'jira',
      'jsm',
      'linear',
      'microsoft_excel',
      'microsoft_teams',
      'monday',
      'onedrive',
      'outlook',
      'salesforce',
      'sharepoint',
      'slack',
      'zoom',
    ])
  })

  it.each(permissionScoped.map((meta) => [meta.id, meta] as const))(
    '%s authenticates through a Credential Group provider whose option scopes cover its read scopes',
    (_id, meta) => {
      expect(meta.auth.mode).toBe('oauth')
      if (meta.auth.mode !== 'oauth') return

      const provider = getCredentialGroupProviderFromProviderId(meta.auth.provider)
      const adapter = getCredentialGroupProviderAdapter(provider)
      expect(
        adapter.hasRequiredScopes(optionScopesFor(provider), meta.auth.requiredScopes ?? [])
      ).toBe(true)
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
