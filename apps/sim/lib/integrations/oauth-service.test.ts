import integrationsJson from '@sim/deployment-config/integrations.json'
import { describe, expect, it } from 'vitest'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
  resolveServiceAccountServiceForIntegration,
} from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'

const INTEGRATIONS = integrationsJson.integrations as readonly Integration[]

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
  it.each(['netsuite', 'snowflake', 'harmonic', 'claude-platform'])(
    'resolves %s without offering OAuth',
    (serviceId) => {
      const integration = INTEGRATIONS.find((entry) => entry.serviceAccountServiceId === serviceId)
      if (!integration) throw new Error(`Missing service-account integration for ${serviceId}`)
      expect(integration.authType).toBe('api-key')
      expect(resolveOAuthServiceForSlug(integration.slug)).toBeNull()
      expect(
        resolveServiceAccountServiceForIntegration(integration)?.serviceAccountProviderId
      ).toBe(`${serviceId}-service-account`)
      expect(resolveServiceAccountIntegration(serviceId)?.slug).toBe(integration.slug)
    }
  )

  /**
   * The match carries its own icon because the connect control cannot recover
   * one for these four: `resolveOAuthServiceForSlug` answers `null` for a
   * non-OAuth catalog entry, and a missing icon makes
   * `useServiceAccountConnectTarget` return `null` — rendering nothing at all
   * rather than a broken chip, which is why the gap was invisible.
   */
  it('carries a service icon on every service-account match', () => {
    const matches = INTEGRATIONS.map((entry) => ({
      slug: entry.slug,
      match: resolveServiceAccountIntegration(entry.slug),
    })).filter(({ match }) => match)
    expect(matches.length).toBeGreaterThan(0)
    for (const { slug, match } of matches) {
      expect(typeof match?.serviceIcon, slug).toBe('function')
    }
    for (const serviceId of ['netsuite', 'snowflake', 'harmonic', 'claude-platform']) {
      const integration = INTEGRATIONS.find((entry) => entry.serviceAccountServiceId === serviceId)
      if (!integration) throw new Error(`Missing service-account integration for ${serviceId}`)
      expect(resolveServiceAccountIntegration(integration.slug)?.serviceIcon, serviceId).toBe(
        resolveServiceAccountServiceForIntegration(integration)?.serviceIcon
      )
    }
  })

  it('only offers the OAuth fallback when the canonical service supports stored accounts', () => {
    const jira = INTEGRATIONS.find((entry) => entry.slug === 'jira')
    const x = INTEGRATIONS.find((entry) => entry.type === 'x')
    if (!jira || !x) throw new Error('Missing OAuth integration fixtures')
    expect(resolveServiceAccountServiceForIntegration(jira)?.serviceAccountProviderId).toBe(
      'atlassian-service-account'
    )
    expect(resolveServiceAccountServiceForIntegration(x)).toBeNull()
    expect(
      resolveServiceAccountServiceForIntegration({
        ...x,
        serviceAccountServiceId: 'unknown-service',
      })
    ).toBeNull()
  })
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
