import {
  getIntegrationTypesForOAuthServiceId,
  isOAuthServiceAllowedByIntegrationTypes,
} from '@sim/deployment-config/integration-availability'
import integrationsJson from '@sim/deployment-config/integrations.json'
import { describe, expect, it } from 'vitest'
import { getIntegrationsForCredentialProvider } from '@/lib/integrations/credential-display'
import { resolveOAuthServiceForIntegration } from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { credentialProviderMatchesService } from '@/lib/oauth/utils'

const INTEGRATIONS = integrationsJson.integrations as readonly Integration[]

/**
 * Every catalog integration each service-account provider id authenticates.
 *
 * This table is the regression guard for the family-credential fix. Credential
 * display resolves through `OAUTH_PROVIDERS`, which is walked in declaration
 * order — reordering it, or adding a provider that claims an existing
 * service-account id, silently changes which product pages a credential appears
 * on. Two entries here are the fix itself:
 *
 * - `atlassian-service-account` previously matched **nothing** (it resolves to
 *   the `Atlassian Service Account` pseudo-service, whose providerId equals no
 *   product's), so a service account added from the Jira page vanished from
 *   Jira, Jira Service Management, and Confluence alike.
 * - `google-service-account` previously matched Gmail only, because Gmail is the
 *   first Google service declared.
 *
 * Every other row must stay exactly as it was before the fix.
 */
const EXPECTED_COVERAGE: Record<string, string[]> = {
  'airtable-service-account': ['airtable'],
  'asana-service-account': ['asana'],
  'atlassian-service-account': ['confluence', 'jira', 'jira-service-management'],
  'attio-service-account': ['attio'],
  'box-service-account': ['box'],
  'calcom-service-account': ['cal-com'],
  'claude-platform-service-account': [],
  'clickup-service-account': ['clickup'],
  'coda-service-account': ['coda'],
  'github-app-installation': ['github'],
  'google-service-account': [
    'gmail',
    'google-bigquery',
    'google-calendar',
    'google-contacts',
    'google-docs',
    'google-drive',
    'google-forms',
    'google-groups',
    'google-meet',
    'google-sheets',
    'google-slides',
    'google-tasks',
    'google-vault',
  ],
  'harmonic-service-account': [],
  'hubspot-service-account': ['hubspot'],
  'linear-service-account': ['linear'],
  'monday-service-account': ['monday'],
  'notion-service-account': ['notion'],
  // NetSuite remains an API-key catalog integration, like Snowflake, while its
  // block uses the shared reusable-credential selector.
  'netsuite-service-account': [],
  'pipedrive-service-account': ['pipedrive'],
  'salesforce-service-account': ['salesforce'],
  'shopify-service-account': ['shopify'],
  'slack-custom-bot': ['slack'],
  // Snowflake's catalog entry is api-key (there is no Snowflake OAuth client),
  // so its credential is offered on the block rather than an integration page.
  'snowflake-service-account': [],
  'trello-service-account': ['trello'],
  'wealthbox-service-account': ['wealthbox'],
  'webflow-service-account': ['webflow'],
  'zoho-desk-service-account': ['zoho-desk'],
  'zoom-service-account': ['zoom'],
}

/** Every provider id some service designates as its service-account id. */
const REGISTERED_SERVICE_ACCOUNT_IDS = [
  ...new Set(
    Object.values(OAUTH_PROVIDERS).flatMap((provider) =>
      Object.values(provider.services).flatMap((service) =>
        service.serviceAccountProviderId ? [service.serviceAccountProviderId] : []
      )
    )
  ),
].sort()

describe('GitHub Search credentials', () => {
  it('applies GitHub integration policy without changing workflow token authentication', () => {
    expect(getIntegrationTypesForOAuthServiceId('github-repositories')).toEqual(['github_v2'])
    expect(getIntegrationTypesForOAuthServiceId('GITHUB-REPOSITORIES')).toEqual(['github_v2'])
    expect(isOAuthServiceAllowedByIntegrationTypes('github-repositories', new Set(['slack']))).toBe(
      false
    )
    expect(
      isOAuthServiceAllowedByIntegrationTypes('github-repositories', new Set(['github_v2']))
    ).toBe(true)
    expect(isOAuthServiceAllowedByIntegrationTypes('github-repositories', null)).toBe(true)
    expect(getIntegrationsForCredentialProvider('github-repositories')).toEqual([
      expect.objectContaining({ slug: 'github', type: 'github_v2', authType: 'api-key' }),
    ])
    expect(getIntegrationsForCredentialProvider('github')).toEqual([])
  })
})

describe('service-account coverage', () => {
  it('pins the table to exactly the registered service-account provider ids', () => {
    expect(REGISTERED_SERVICE_ACCOUNT_IDS).toEqual(Object.keys(EXPECTED_COVERAGE).sort())
  })

  it.each(Object.entries(EXPECTED_COVERAGE))(
    '%s authenticates the expected integrations',
    (providerId, expectedSlugs) => {
      const slugs = getIntegrationsForCredentialProvider(providerId)
        .map((i) => i.slug)
        .sort()
      expect(slugs).toEqual([...expectedSlugs].sort())
    }
  )

  /**
   * The integration detail page filters its "Connected" list with the
   * predicate, not with this index, so the two must not drift. Without this
   * the index could be right while the page still hid the credential — the
   * original bug.
   */
  it('agrees with the predicate the Connected list actually filters on', () => {
    for (const providerId of REGISTERED_SERVICE_ACCOUNT_IDS) {
      const covered = new Set(getIntegrationsForCredentialProvider(providerId).map((i) => i.slug))

      for (const integration of INTEGRATIONS) {
        const service = resolveOAuthServiceForIntegration(integration)
        if (!service) continue
        expect(
          credentialProviderMatchesService(providerId, service),
          `${providerId} vs ${integration.slug}`
        ).toBe(covered.has(integration.slug))
      }
    }
  })
})
