/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import integrationsJson from '@/lib/integrations/integrations.json'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'

const INTEGRATIONS = integrationsJson.integrations as readonly Integration[]

/**
 * Pinned slug → OAuth providerId mapping for every OAuth integration in the
 * catalog. Guards against silent drift between block `serviceId`s, the
 * generated catalog, and `OAUTH_PROVIDERS` — the failure mode that made
 * Jira Service Management, Google Slides, and Monday fall back to the
 * API-key connect path.
 */
const EXPECTED_PROVIDER_BY_SLUG: Record<string, string> = {
  airtable: 'airtable',
  asana: 'asana',
  attio: 'attio',
  'azure-ad': 'microsoft-ad',
  box: 'box',
  'cal-com': 'calcom',
  confluence: 'confluence',
  docusign: 'docusign',
  dropbox: 'dropbox',
  gmail: 'google-email',
  'google-ads': 'google-ads',
  'google-bigquery': 'google-bigquery',
  'google-calendar': 'google-calendar',
  'google-contacts': 'google-contacts',
  'google-docs': 'google-docs',
  'google-drive': 'google-drive',
  'google-forms': 'google-forms',
  'google-groups': 'google-groups',
  'google-meet': 'google-meet',
  'google-sheets': 'google-sheets',
  'google-slides': 'google-drive',
  'google-tasks': 'google-tasks',
  'google-vault': 'google-vault',
  hubspot: 'hubspot',
  jira: 'jira',
  'jira-service-management': 'jira',
  linear: 'linear',
  linkedin: 'linkedin',
  'microsoft-dataverse': 'microsoft-dataverse',
  'microsoft-excel': 'microsoft-excel',
  'microsoft-planner': 'microsoft-planner',
  'microsoft-teams': 'microsoft-teams',
  monday: 'monday',
  notion: 'notion',
  onedrive: 'onedrive',
  outlook: 'outlook',
  pipedrive: 'pipedrive',
  reddit: 'reddit',
  salesforce: 'salesforce',
  sharepoint: 'sharepoint',
  shopify: 'shopify',
  slack: 'slack',
  trello: 'trello',
  wealthbox: 'wealthbox',
  webflow: 'webflow',
  wordpress: 'wordpress',
  x: 'x',
  zoom: 'zoom',
}

describe('resolveOAuthServiceForSlug', () => {
  it.concurrent('resolves integrations whose name differs from the OAuth service name', () => {
    const jsm = resolveOAuthServiceForSlug('jira-service-management')
    expect(jsm?.providerId).toBe('jira')
    expect(jsm?.serviceName).toBe('Jira')

    const slides = resolveOAuthServiceForSlug('google-slides')
    expect(slides?.providerId).toBe('google-drive')

    const monday = resolveOAuthServiceForSlug('monday')
    expect(monday?.providerId).toBe('monday')
  })

  it.concurrent('resolves integrations whose name matches the OAuth service name', () => {
    const jira = resolveOAuthServiceForSlug('jira')
    expect(jira?.providerId).toBe('jira')
    expect(jira?.serviceName).toBe('Jira')

    const gmail = resolveOAuthServiceForSlug('gmail')
    expect(gmail?.providerId).toBe('google-email')
  })

  it.concurrent('returns null for unknown slugs', () => {
    expect(resolveOAuthServiceForSlug('not-a-real-integration')).toBeNull()
  })

  it.concurrent('returns null for non-OAuth integrations', () => {
    const apiKeyIntegration = INTEGRATIONS.find((entry) => entry.authType === 'api-key')
    expect(apiKeyIntegration).toBeDefined()
    expect(resolveOAuthServiceForSlug(apiKeyIntegration!.slug)).toBeNull()
  })

  it.concurrent('resolves every OAuth integration in the catalog', () => {
    const oauthIntegrations = INTEGRATIONS.filter((entry) => entry.authType === 'oauth')
    expect(oauthIntegrations.length).toBeGreaterThan(0)

    const unresolved = oauthIntegrations
      .filter((entry) => resolveOAuthServiceForSlug(entry.slug) === null)
      .map((entry) => entry.slug)
    expect(unresolved).toEqual([])
  })

  it.concurrent('resolves the pinned provider for every enumerated OAuth integration', () => {
    const resolved = Object.fromEntries(
      Object.keys(EXPECTED_PROVIDER_BY_SLUG).map((slug) => [
        slug,
        resolveOAuthServiceForSlug(slug)?.providerId ?? null,
      ])
    )
    expect(resolved).toEqual(EXPECTED_PROVIDER_BY_SLUG)
  })

  it.concurrent('carries oauthServiceId for exactly the OAuth catalog entries', () => {
    const missing = INTEGRATIONS.filter(
      (entry) => entry.authType === 'oauth' && !entry.oauthServiceId
    ).map((entry) => entry.slug)
    const unexpected = INTEGRATIONS.filter(
      (entry) => entry.authType !== 'oauth' && entry.oauthServiceId
    ).map((entry) => entry.slug)
    expect(missing).toEqual([])
    expect(unexpected).toEqual([])
  })
})

describe('resolveServiceAccountIntegration', () => {
  it.concurrent('keeps a named service instead of collapsing to the family default', () => {
    // Every Google integration issues the same google-service-account
    // credential, so a fuzzy matcher can silently answer Drive for all of
    // them. The user asked about Sheets; the link must land on Sheets.
    expect(resolveServiceAccountIntegration('google-sheets')?.slug).toBe('google-sheets')
    expect(resolveServiceAccountIntegration('gmail')?.slug).toBe('gmail')
    expect(resolveServiceAccountIntegration('confluence')?.slug).toBe('confluence')
  })

  it.concurrent('resolves a family name to its canonical slug, not an arbitrary member', () => {
    // Without an explicit canonical entry these fall through to fuzzy
    // matching, which answers whichever member sorts first (BigQuery).
    expect(resolveServiceAccountIntegration('google')?.slug).toBe('google-drive')
    expect(resolveServiceAccountIntegration('google-service-account')?.slug).toBe('google-drive')
    expect(resolveServiceAccountIntegration('atlassian')?.slug).toBe('jira')
    expect(resolveServiceAccountIntegration('atlassian-service-account')?.slug).toBe('jira')
  })

  it.concurrent('accepts provider values, display names, and stray casing', () => {
    expect(resolveServiceAccountIntegration('google-email')?.slug).toBe('gmail')
    expect(resolveServiceAccountIntegration('slack-custom-bot')?.slug).toBe('slack')
    expect(resolveServiceAccountIntegration('calcom')?.slug).toBe('cal-com')
    expect(resolveServiceAccountIntegration('Cal.com')?.slug).toBe('cal-com')
    expect(resolveServiceAccountIntegration('  NOTION  ')?.slug).toBe('notion')
  })

  it.concurrent('returns null rather than inventing a link for unsupported input', () => {
    // The handler turns null into "use oauth_get_auth_link instead"; a wrong
    // match here would send the user to a modal that cannot take their key.
    expect(resolveServiceAccountIntegration('github')).toBeNull()
    expect(resolveServiceAccountIntegration('dropbox')).toBeNull()
    expect(resolveServiceAccountIntegration('')).toBeNull()
    expect(resolveServiceAccountIntegration('   ')).toBeNull()
  })
})
