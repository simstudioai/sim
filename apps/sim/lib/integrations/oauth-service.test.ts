/**
 * @vitest-environment node
 */
import { stripVersionSuffix } from '@sim/utils/string'
import { describe, expect, it } from 'vitest'
import integrationsJson from '@/lib/integrations/integrations.json'
import {
  resolveIntegrationBlockTypeForOAuth,
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'
import { getBlockTileColor, getBlockTileIcon } from '@/blocks/accent'

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

  it.concurrent(
    'accepts the space/underscore-normalized id forms the oauth guard steers toward',
    () => {
      // oauth_get_auth_link rejects `slack custom bot` / `notion_service_account`
      // and tells the agent to emit a service_account tag; the renderer must then
      // resolve those same readable forms or the connect control renders nothing.
      expect(resolveServiceAccountIntegration('slack custom bot')?.slug).toBe('slack')
      expect(resolveServiceAccountIntegration('notion_service_account')?.slug).toBe('notion')
      expect(resolveServiceAccountIntegration('google service account')?.slug).toBe('google-drive')
    }
  )

  it.concurrent('returns null rather than inventing a link for unsupported input', () => {
    // The handler turns null into "use oauth_get_auth_link instead"; a wrong
    // match here would send the user to a modal that cannot take their key.
    expect(resolveServiceAccountIntegration('github')).toBeNull()
    expect(resolveServiceAccountIntegration('dropbox')).toBeNull()
    expect(resolveServiceAccountIntegration('')).toBeNull()
    expect(resolveServiceAccountIntegration('   ')).toBeNull()
  })
})

/**
 * Integrations whose `oauthServiceId` is shared with a sibling, so the id names
 * a pair rather than a block: Google Slides rides Drive's service, Jira Service
 * Management rides Jira's. The bridge deliberately resolves none of them.
 */
const SHARED_OAUTH_ID_SLUGS = ['google-drive', 'google-slides', 'jira', 'jira-service-management']

/** Resolved block type with any version suffix dropped, for stable assertions. */
function baseTypeFor(...keys: (string | undefined)[]): string | undefined {
  const blockType = resolveIntegrationBlockTypeForOAuth(...keys)
  return blockType ? stripVersionSuffix(blockType) : undefined
}

describe('resolveIntegrationBlockTypeForOAuth', () => {
  it.concurrent('resolves a service id, a provider id, and an extra auth server', () => {
    // Each is a distinct key shape a credential surface can be holding: the
    // service id a block declares, the provider id that service registers, and
    // the second authorization server Salesforce accepts. The catalog carries
    // versioned types (`gmail_v2`), so compare on the base — the version that
    // wins is whichever the catalog lists first and is not the contract here.
    expect(baseTypeFor('gmail')).toBe('gmail')
    expect(baseTypeFor('google-email')).toBe('gmail')
    expect(baseTypeFor('salesforce-sandbox')).toBe('salesforce')
  })

  it.concurrent('is case-insensitive and skips empty keys', () => {
    expect(baseTypeFor('GOOGLE-EMAIL')).toBe('gmail')
    expect(resolveIntegrationBlockTypeForOAuth(undefined, '', 'slack')).toBeDefined()
  })

  it.concurrent('takes the first key that resolves, so callers can order by specificity', () => {
    // A connect dialog passes the service id before the provider id it derives
    // from; the specific one has to win or every Google service would render
    // whichever member the catalog happens to list first.
    expect(baseTypeFor('google-sheets', 'google-email')).toBe('google_sheets')
    expect(baseTypeFor('unknown-service', 'google-email')).toBe('gmail')
  })

  it.concurrent('returns undefined for an id no catalog integration claims', () => {
    // The signal to keep the caller's existing mark rather than invent one.
    expect(resolveIntegrationBlockTypeForOAuth('not-a-real-service')).toBeUndefined()
    expect(resolveIntegrationBlockTypeForOAuth()).toBeUndefined()
    expect(resolveIntegrationBlockTypeForOAuth(undefined, '')).toBeUndefined()
  })

  it.concurrent('refuses to guess when one OAuth id names more than one block', () => {
    // Google Slides is authenticated by Drive's service and JSM by Jira's, so
    // these ids name a pair. Answering with either member would put the wrong
    // brand on the other's connect dialog, so the bridge declines.
    expect(resolveIntegrationBlockTypeForOAuth('google-drive')).toBeUndefined()
    expect(resolveIntegrationBlockTypeForOAuth('jira')).toBeUndefined()
  })

  it.concurrent('resolves every OAuth integration whose id names it alone', () => {
    // A credential surface that cannot reach a block type falls back to the
    // colourless OAUTH_PROVIDERS mark, which is the bug this bridge exists to
    // close — so every unambiguous integration must be in the index, and the
    // only permitted misses are the shared ids above.
    const unresolved = INTEGRATIONS.filter(
      (integration) =>
        integration.authType === 'oauth' &&
        integration.oauthServiceId &&
        !resolveIntegrationBlockTypeForOAuth(integration.oauthServiceId)
    ).map((integration) => integration.slug)

    expect(unresolved.sort()).toEqual(SHARED_OAUTH_ID_SLUGS)
  })
})

describe('the OAuth bridge reaches a renderable tile', () => {
  it('resolves every OAuth integration to a block carrying both an icon and a fill', () => {
    // The bridge exists so a credential surface can draw the block's tile.
    // A type that resolves but has no registered icon or colour would paint an
    // empty square in the connect dialog — worse than the grey mark it replaced.
    const broken = INTEGRATIONS.filter(
      (integration) =>
        integration.authType === 'oauth' &&
        integration.oauthServiceId &&
        !SHARED_OAUTH_ID_SLUGS.includes(integration.slug)
    ).flatMap((integration) => {
      const blockType = resolveIntegrationBlockTypeForOAuth(integration.oauthServiceId)
      if (!blockType) return [`${integration.slug}: unresolved`]
      if (!getBlockTileIcon(blockType)) return [`${integration.slug} -> ${blockType}: no icon`]
      if (!getBlockTileColor(blockType)) return [`${integration.slug} -> ${blockType}: no fill`]
      return []
    })

    expect(broken).toEqual([])
  })
})
