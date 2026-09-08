/**
 * @vitest-environment node
 */

import {
  getIntegrationTypesForOAuthServiceId,
  isOAuthServiceAllowedByIntegrationTypes,
} from '@sim/deployment-config/integration-availability'
import integrationsJson from '@sim/deployment-config/integrations.json'
import { describe, expect, it } from 'vitest'
import {
  getIntegrationsForCredentialProvider,
  getServiceAccountCoverageSentence,
  getServiceAccountFamilyName,
  isFamilyServiceAccount,
  resolveCredentialDisplay,
} from '@/lib/integrations/credential-display'
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

const serviceAccount = (providerId: string) => ({
  type: 'service_account',
  displayName: 'Automation Bot',
  providerId,
})

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

  it('uses the GitHub brand and category for a connected Search account', () => {
    const display = resolveCredentialDisplay({
      type: 'oauth',
      displayName: 'someone@example.com',
      providerId: 'github-repositories',
    })

    expect(display.blockType).toBe('github_v2')
    expect(display.integration?.slug).toBe('github')
    expect(display.coveredIntegrations.map((integration) => integration.slug)).toEqual(['github'])
  })
})

describe('service-account coverage', () => {
  it('exposes NetSuite reusable credentials without changing its API-key catalog class', () => {
    const netSuiteIntegration = INTEGRATIONS.find((integration) => integration.type === 'netsuite')
    expect(netSuiteIntegration?.authType).toBe('api-key')
    expect(OAUTH_PROVIDERS.netsuite.services.netsuite).toMatchObject({
      providerId: 'netsuite',
      serviceAccountProviderId: 'netsuite-service-account',
      authType: 'service_account',
    })
  })

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

  it('treats only multi-integration service accounts as families', () => {
    const families = REGISTERED_SERVICE_ACCOUNT_IDS.filter(isFamilyServiceAccount)
    expect(families).toEqual(['atlassian-service-account', 'google-service-account'])
  })

  it('names families after the vendor, not one of its products', () => {
    expect(getServiceAccountFamilyName('atlassian-service-account')).toBe('Atlassian')
    expect(getServiceAccountFamilyName('google-service-account')).toBe('Google')
    expect(getServiceAccountFamilyName('notion-service-account')).toBeNull()
  })
})

describe('resolveCredentialDisplay', () => {
  it('gives an Atlassian service account a vendor identity and a Jira brand tile', () => {
    const display = resolveCredentialDisplay(serviceAccount('atlassian-service-account'))

    expect(display.familyName).toBe('Atlassian')
    expect(display.detailTitle).toBe('Automation Bot')
    expect(display.subtitle).toBe(
      'Atlassian service account · Confluence, Jira, and Jira Service Management'
    )
    // Without a catalog fallback the name lookup misses and the row loses both
    // its brand tile and its category filter membership.
    expect(display.blockType).toBe('jira')
    expect(display.integration?.integrationType).toBeTruthy()
  })

  it('states a count rather than enumerating 13 Google integrations', () => {
    const display = resolveCredentialDisplay(serviceAccount('google-service-account'))

    expect(display.familyName).toBe('Google')
    expect(display.subtitle).toBe('Google service account · all 13 Google integrations')
  })

  it('uses each vendor own noun for non-family service accounts', () => {
    expect(resolveCredentialDisplay(serviceAccount('slack-custom-bot')).subtitle).toBe(
      'Slack custom bot'
    )
    expect(resolveCredentialDisplay(serviceAccount('notion-service-account')).subtitle).toBe(
      'Notion integration secret'
    )
  })

  it('leaves OAuth credentials titled by their service', () => {
    const display = resolveCredentialDisplay({
      type: 'oauth',
      displayName: 'someone@example.com',
      providerId: 'jira',
    })

    expect(display.familyName).toBeNull()
    expect(display.detailTitle).toBe('Jira')
    expect(display.subtitle).toBe('Jira integration')
    expect(display.blockType).toBe('jira')
  })

  /**
   * The detail page has always subtitled with the service's own description.
   * Reusing the list subtitle there would restate the title ("Jira" over "Jira
   * integration") and throw away the richer copy, so only family service
   * accounts — which genuinely need their reach spelled out — diverge.
   */
  it('keeps the service description as the detail subtitle for non-family credentials', () => {
    const oauth = resolveCredentialDisplay({
      type: 'oauth',
      displayName: 'someone@example.com',
      providerId: 'jira',
    })
    expect(oauth.detailSubtitle).toBe('Access Jira projects, issues, and Service Management.')

    const singleProductServiceAccount = resolveCredentialDisplay(
      serviceAccount('notion-service-account')
    )
    expect(singleProductServiceAccount.detailSubtitle).toBe(
      singleProductServiceAccount.service?.description
    )
  })

  it('spells out reach on the detail page only for family service accounts', () => {
    const display = resolveCredentialDisplay(serviceAccount('atlassian-service-account'))
    expect(display.detailSubtitle).toBe(display.subtitle)
    expect(display.detailSubtitle).toContain('Jira Service Management')
  })

  it('degrades safely for a credential with no provider', () => {
    const display = resolveCredentialDisplay({
      type: 'service_account',
      displayName: 'Orphan',
      providerId: null,
    })

    expect(display.service).toBeNull()
    expect(display.icon).toBeNull()
    expect(display.blockType).toBe('')
    expect(display.detailTitle).toBe('Orphan')
  })
})

describe('getServiceAccountCoverageSentence', () => {
  it('tells the user up front that one Atlassian token spans all three products', () => {
    expect(getServiceAccountCoverageSentence('atlassian-service-account')).toBe(
      'One token works across Confluence, Jira, and Jira Service Management.'
    )
  })

  it('returns null for providers that map to a single integration', () => {
    expect(getServiceAccountCoverageSentence('notion-service-account')).toBeNull()
  })
})
