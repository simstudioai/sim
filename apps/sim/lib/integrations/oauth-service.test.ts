/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import integrationsJson from '@/lib/integrations/integrations.json'
import { resolveOAuthServiceForSlug } from '@/lib/integrations/oauth-service'
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
})
