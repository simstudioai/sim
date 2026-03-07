import { describe, expect, it } from 'vitest'
import type { OAuthProvider, OAuthServiceMetadata } from './types'
import {
  getAllOAuthServices,
  getCanonicalScopesForProvider,
  getMissingRequiredScopes,
  getProviderIdFromServiceId,
  getScopesForService,
  getServiceByProviderAndId,
  getServiceConfigByProviderId,
  parseProvider,
} from './utils'

describe('getAllOAuthServices', () => {
  it.concurrent('should return an array of OAuth services', () => {
    const services = getAllOAuthServices()

    expect(services).toBeInstanceOf(Array)
    expect(services.length).toBeGreaterThan(0)
  })

  it.concurrent('should include all required metadata fields for each service', () => {
    const services = getAllOAuthServices()

    services.forEach((service) => {
      expect(service).toHaveProperty('providerId')
      expect(service).toHaveProperty('name')
      expect(service).toHaveProperty('description')
      expect(service).toHaveProperty('baseProvider')

      expect(typeof service.providerId).toBe('string')
      expect(typeof service.name).toBe('string')
      expect(typeof service.description).toBe('string')
      expect(typeof service.baseProvider).toBe('string')
    })
  })

  it.concurrent('should include Google services', () => {
    const services = getAllOAuthServices()

    const gmailService = services.find((s) => s.providerId === 'google-email')
    expect(gmailService).toBeDefined()
    expect(gmailService?.name).toBe('Gmail')
    expect(gmailService?.baseProvider).toBe('google')

    const driveService = services.find((s) => s.providerId === 'google-drive')
    expect(driveService).toBeDefined()
    expect(driveService?.name).toBe('Google Drive')
    expect(driveService?.baseProvider).toBe('google')
  })

  it.concurrent('should include Microsoft services', () => {
    const services = getAllOAuthServices()

    const outlookService = services.find((s) => s.providerId === 'outlook')
    expect(outlookService).toBeDefined()
    expect(outlookService?.name).toBe('Outlook')
    expect(outlookService?.baseProvider).toBe('microsoft')

    const excelService = services.find((s) => s.providerId === 'microsoft-excel')
    expect(excelService).toBeDefined()
    expect(excelService?.name).toBe('Microsoft Excel')
    expect(excelService?.baseProvider).toBe('microsoft')
  })

  it.concurrent('should include single-service providers', () => {
    const services = getAllOAuthServices()

    const githubService = services.find((s) => s.providerId === 'github-repo')
    expect(githubService).toBeDefined()
    expect(githubService?.name).toBe('GitHub')
    expect(githubService?.baseProvider).toBe('github')

    const slackService = services.find((s) => s.providerId === 'slack')
    expect(slackService).toBeDefined()
    expect(slackService?.name).toBe('Slack')
    expect(slackService?.baseProvider).toBe('slack')
  })

  it.concurrent('should not include duplicate services', () => {
    const services = getAllOAuthServices()
    const providerIds = services.map((s) => s.providerId)
    const uniqueProviderIds = new Set(providerIds)

    expect(providerIds.length).toBe(uniqueProviderIds.size)
  })

  it.concurrent('should return services that match the OAuthServiceMetadata interface', () => {
    const services = getAllOAuthServices()

    services.forEach((service) => {
      const metadata: OAuthServiceMetadata = service
      expect(metadata.providerId).toBeDefined()
      expect(metadata.name).toBeDefined()
      expect(metadata.description).toBeDefined()
      expect(metadata.baseProvider).toBeDefined()
    })
  })
})

describe('getServiceByProviderAndId', () => {
  it.concurrent('should return default service when no serviceId is provided', () => {
    const service = getServiceByProviderAndId('google')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('google-email')
    expect(service.name).toBe('Gmail')
  })

  it.concurrent('should return specific service when serviceId is provided', () => {
    const service = getServiceByProviderAndId('google', 'google-drive')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('google-drive')
    expect(service.name).toBe('Google Drive')
  })

  it.concurrent('should return default service when invalid serviceId is provided', () => {
    const service = getServiceByProviderAndId('google', 'invalid-service')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('google-email')
    expect(service.name).toBe('Gmail')
  })

  it.concurrent('should throw error for invalid provider', () => {
    expect(() => {
      getServiceByProviderAndId('invalid-provider' as OAuthProvider)
    }).toThrow('Provider invalid-provider not found')
  })

  it.concurrent('should work with Microsoft provider', () => {
    const service = getServiceByProviderAndId('microsoft')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('outlook')
    expect(service.name).toBe('Outlook')
  })

  it.concurrent('should work with Microsoft Excel serviceId', () => {
    const service = getServiceByProviderAndId('microsoft', 'microsoft-excel')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('microsoft-excel')
    expect(service.name).toBe('Microsoft Excel')
  })

  it.concurrent('should work with single-service providers', () => {
    const service = getServiceByProviderAndId('github')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('github-repo')
    expect(service.name).toBe('GitHub')
  })

  it.concurrent('should include scopes in returned service config', () => {
    const service = getServiceByProviderAndId('google', 'gmail')

    expect(service.scopes).toBeDefined()
    expect(Array.isArray(service.scopes)).toBe(true)
    expect(service.scopes.length).toBeGreaterThan(0)
    expect(service.scopes).toContain('https://www.googleapis.com/auth/gmail.send')
  })
})

describe('getProviderIdFromServiceId', () => {
  it.concurrent('should return correct providerId for Gmail', () => {
    const providerId = getProviderIdFromServiceId('gmail')

    expect(providerId).toBe('google-email')
  })

  it.concurrent('should return correct providerId for Google Drive', () => {
    const providerId = getProviderIdFromServiceId('google-drive')

    expect(providerId).toBe('google-drive')
  })

  it.concurrent('should return correct providerId for Outlook', () => {
    const providerId = getProviderIdFromServiceId('outlook')

    expect(providerId).toBe('outlook')
  })

  it.concurrent('should return correct providerId for GitHub', () => {
    const providerId = getProviderIdFromServiceId('github')

    expect(providerId).toBe('github-repo')
  })

  it.concurrent('should return correct providerId for Microsoft Excel', () => {
    const providerId = getProviderIdFromServiceId('microsoft-excel')

    expect(providerId).toBe('microsoft-excel')
  })

  it.concurrent('should return serviceId as fallback for unknown service', () => {
    const providerId = getProviderIdFromServiceId('unknown-service')

    expect(providerId).toBe('unknown-service')
  })

  it.concurrent('should handle empty string', () => {
    const providerId = getProviderIdFromServiceId('')

    expect(providerId).toBe('')
  })

  it.concurrent('should work for all Google services', () => {
    const googleServices = [
      { serviceId: 'gmail', expectedProviderId: 'google-email' },
      { serviceId: 'google-drive', expectedProviderId: 'google-drive' },
      { serviceId: 'google-docs', expectedProviderId: 'google-docs' },
      { serviceId: 'google-sheets', expectedProviderId: 'google-sheets' },
      { serviceId: 'google-forms', expectedProviderId: 'google-forms' },
      { serviceId: 'google-calendar', expectedProviderId: 'google-calendar' },
      { serviceId: 'google-vault', expectedProviderId: 'google-vault' },
      { serviceId: 'google-groups', expectedProviderId: 'google-groups' },
      { serviceId: 'vertex-ai', expectedProviderId: 'vertex-ai' },
    ]

    googleServices.forEach(({ serviceId, expectedProviderId }) => {
      expect(getProviderIdFromServiceId(serviceId)).toBe(expectedProviderId)
    })
  })
})

describe('getServiceConfigByProviderId', () => {
  it.concurrent('should return service config for valid providerId', () => {
    const service = getServiceConfigByProviderId('google-email')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('google-email')
    expect(service?.name).toBe('Gmail')
  })

  it.concurrent('should return service config for service key', () => {
    const service = getServiceConfigByProviderId('gmail')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('google-email')
    expect(service?.name).toBe('Gmail')
  })

  it.concurrent('should return null for invalid providerId', () => {
    const service = getServiceConfigByProviderId('invalid-provider')

    expect(service).toBeNull()
  })

  it.concurrent('should work for Microsoft services', () => {
    const outlookService = getServiceConfigByProviderId('outlook')

    expect(outlookService).toBeDefined()
    expect(outlookService?.providerId).toBe('outlook')
    expect(outlookService?.name).toBe('Outlook')

    const excelService = getServiceConfigByProviderId('microsoft-excel')

    expect(excelService).toBeDefined()
    expect(excelService?.providerId).toBe('microsoft-excel')
    expect(excelService?.name).toBe('Microsoft Excel')
  })

  it.concurrent('should work for GitHub', () => {
    const service = getServiceConfigByProviderId('github-repo')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('github-repo')
    expect(service?.name).toBe('GitHub')
  })

  it.concurrent('should work for Slack', () => {
    const service = getServiceConfigByProviderId('slack')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('slack')
    expect(service?.name).toBe('Slack')
  })

  it.concurrent('should return service with scopes', () => {
    const service = getServiceConfigByProviderId('google-drive')

    expect(service).toBeDefined()
    expect(service?.scopes).toBeDefined()
    expect(Array.isArray(service?.scopes)).toBe(true)
    expect(service?.scopes.length).toBeGreaterThan(0)
  })

  it.concurrent('should handle empty string', () => {
    const service = getServiceConfigByProviderId('')

    expect(service).toBeNull()
  })
})

describe('getCanonicalScopesForProvider', () => {
  it.concurrent('should return scopes for valid providerId', () => {
    const scopes = getCanonicalScopesForProvider('google-email')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify')
  })

  it.concurrent('should return new array instance (not reference)', () => {
    const scopes1 = getCanonicalScopesForProvider('google-email')
    const scopes2 = getCanonicalScopesForProvider('google-email')

    expect(scopes1).not.toBe(scopes2)
    expect(scopes1).toEqual(scopes2)
  })

  it.concurrent('should return empty array for invalid providerId', () => {
    const scopes = getCanonicalScopesForProvider('invalid-provider')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })

  it.concurrent('should work for service key', () => {
    const scopes = getCanonicalScopesForProvider('gmail')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBeGreaterThan(0)
  })

  it.concurrent('should return scopes for Microsoft services', () => {
    const outlookScopes = getCanonicalScopesForProvider('outlook')

    expect(outlookScopes.length).toBeGreaterThan(0)
    expect(outlookScopes).toContain('Mail.ReadWrite')

    const excelScopes = getCanonicalScopesForProvider('microsoft-excel')

    expect(excelScopes.length).toBeGreaterThan(0)
    expect(excelScopes).toContain('Files.Read')
  })

  it.concurrent('should return scopes for GitHub', () => {
    const scopes = getCanonicalScopesForProvider('github-repo')

    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes).toContain('repo')
    expect(scopes).toContain('user:email')
  })

  it.concurrent('should handle providers with empty scopes array', () => {
    const scopes = getCanonicalScopesForProvider('notion')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })

  it.concurrent('should return empty array for empty string', () => {
    const scopes = getCanonicalScopesForProvider('')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })
})

describe('parseProvider', () => {
  it.concurrent('should parse simple provider without hyphen', () => {
    const config = parseProvider('slack' as OAuthProvider)

    expect(config.baseProvider).toBe('slack')
    expect(config.featureType).toBe('slack')
  })

  it.concurrent('should parse compound provider', () => {
    const config = parseProvider('google-email' as OAuthProvider)

    expect(config.baseProvider).toBe('google')
    expect(config.featureType).toBe('gmail')
  })

  it.concurrent('should use mapping for known providerId', () => {
    const config = parseProvider('google-drive' as OAuthProvider)

    expect(config.baseProvider).toBe('google')
    expect(config.featureType).toBe('google-drive')
  })

  it.concurrent('should parse Microsoft services', () => {
    const outlookConfig = parseProvider('outlook' as OAuthProvider)
    expect(outlookConfig.baseProvider).toBe('microsoft')
    expect(outlookConfig.featureType).toBe('outlook')

    const excelConfig = parseProvider('microsoft-excel' as OAuthProvider)
    expect(excelConfig.baseProvider).toBe('microsoft')
    expect(excelConfig.featureType).toBe('microsoft-excel')

    const teamsConfig = parseProvider('microsoft-teams' as OAuthProvider)
    expect(teamsConfig.baseProvider).toBe('microsoft')
    expect(teamsConfig.featureType).toBe('microsoft-teams')
  })

  it.concurrent('should parse GitHub provider', () => {
    const config = parseProvider('github-repo' as OAuthProvider)

    expect(config.baseProvider).toBe('github')
    expect(config.featureType).toBe('github')
  })

  it.concurrent('should parse Slack provider', () => {
    const config = parseProvider('slack' as OAuthProvider)

    expect(config.baseProvider).toBe('slack')
    expect(config.featureType).toBe('slack')
  })

  it.concurrent('should parse X provider', () => {
    const config = parseProvider('x' as OAuthProvider)

    expect(config.baseProvider).toBe('x')
    expect(config.featureType).toBe('x')
  })

  it.concurrent('should parse all Google services correctly', () => {
    const googleServices: Array<{ provider: OAuthProvider; expectedFeature: string }> = [
      { provider: 'google-email', expectedFeature: 'gmail' },
      { provider: 'google-drive', expectedFeature: 'google-drive' },
      { provider: 'google-docs', expectedFeature: 'google-docs' },
      { provider: 'google-sheets', expectedFeature: 'google-sheets' },
      { provider: 'google-forms', expectedFeature: 'google-forms' },
      { provider: 'google-calendar', expectedFeature: 'google-calendar' },
      { provider: 'google-vault', expectedFeature: 'google-vault' },
      { provider: 'google-groups', expectedFeature: 'google-groups' },
      { provider: 'vertex-ai', expectedFeature: 'vertex-ai' },
    ]

    googleServices.forEach(({ provider, expectedFeature }) => {
      const config = parseProvider(provider)
      expect(config.baseProvider).toBe('google')
      expect(config.featureType).toBe(expectedFeature)
    })
  })

  it.concurrent('should parse Confluence provider', () => {
    const config = parseProvider('confluence' as OAuthProvider)

    expect(config.baseProvider).toBe('confluence')
    expect(config.featureType).toBe('confluence')
  })

  it.concurrent('should parse Jira provider', () => {
    const config = parseProvider('jira' as OAuthProvider)

    expect(config.baseProvider).toBe('jira')
    expect(config.featureType).toBe('jira')
  })

  it.concurrent('should parse Airtable provider', () => {
    const config = parseProvider('airtable' as OAuthProvider)

    expect(config.baseProvider).toBe('airtable')
    expect(config.featureType).toBe('airtable')
  })

  it.concurrent('should parse Notion provider', () => {
    const config = parseProvider('notion' as OAuthProvider)

    expect(config.baseProvider).toBe('notion')
    expect(config.featureType).toBe('notion')
  })

  it.concurrent('should parse Linear provider', () => {
    const config = parseProvider('linear' as OAuthProvider)

    expect(config.baseProvider).toBe('linear')
    expect(config.featureType).toBe('linear')
  })

  it.concurrent('should parse Dropbox provider', () => {
    const config = parseProvider('dropbox' as OAuthProvider)

    expect(config.baseProvider).toBe('dropbox')
    expect(config.featureType).toBe('dropbox')
  })

  it.concurrent('should parse Shopify provider', () => {
    const config = parseProvider('shopify' as OAuthProvider)

    expect(config.baseProvider).toBe('shopify')
    expect(config.featureType).toBe('shopify')
  })

  it.concurrent('should parse Reddit provider', () => {
    const config = parseProvider('reddit' as OAuthProvider)

    expect(config.baseProvider).toBe('reddit')
    expect(config.featureType).toBe('reddit')
  })

  it.concurrent('should parse Wealthbox provider', () => {
    const config = parseProvider('wealthbox' as OAuthProvider)

    expect(config.baseProvider).toBe('wealthbox')
    expect(config.featureType).toBe('wealthbox')
  })

  it.concurrent('should parse Webflow provider', () => {
    const config = parseProvider('webflow' as OAuthProvider)

    expect(config.baseProvider).toBe('webflow')
    expect(config.featureType).toBe('webflow')
  })

  it.concurrent('should parse Trello provider', () => {
    const config = parseProvider('trello' as OAuthProvider)

    expect(config.baseProvider).toBe('trello')
    expect(config.featureType).toBe('trello')
  })

  it.concurrent('should parse Asana provider', () => {
    const config = parseProvider('asana' as OAuthProvider)

    expect(config.baseProvider).toBe('asana')
    expect(config.featureType).toBe('asana')
  })

  it.concurrent('should parse Pipedrive provider', () => {
    const config = parseProvider('pipedrive' as OAuthProvider)

    expect(config.baseProvider).toBe('pipedrive')
    expect(config.featureType).toBe('pipedrive')
  })

  it.concurrent('should parse HubSpot provider', () => {
    const config = parseProvider('hubspot' as OAuthProvider)

    expect(config.baseProvider).toBe('hubspot')
    expect(config.featureType).toBe('hubspot')
  })

  it.concurrent('should parse LinkedIn provider', () => {
    const config = parseProvider('linkedin' as OAuthProvider)

    expect(config.baseProvider).toBe('linkedin')
    expect(config.featureType).toBe('linkedin')
  })

  it.concurrent('should parse Salesforce provider', () => {
    const config = parseProvider('salesforce' as OAuthProvider)

    expect(config.baseProvider).toBe('salesforce')
    expect(config.featureType).toBe('salesforce')
  })

  it.concurrent('should parse Zoom provider', () => {
    const config = parseProvider('zoom' as OAuthProvider)

    expect(config.baseProvider).toBe('zoom')
    expect(config.featureType).toBe('zoom')
  })

  it.concurrent('should parse WordPress provider', () => {
    const config = parseProvider('wordpress' as OAuthProvider)

    expect(config.baseProvider).toBe('wordpress')
    expect(config.featureType).toBe('wordpress')
  })

  it.concurrent('should parse Spotify provider', () => {
    const config = parseProvider('spotify' as OAuthProvider)

    expect(config.baseProvider).toBe('spotify')
    expect(config.featureType).toBe('spotify')
  })

  it.concurrent('should fallback to default for unknown compound provider', () => {
    const config = parseProvider('unknown-provider' as OAuthProvider)

    expect(config.baseProvider).toBe('unknown')
    expect(config.featureType).toBe('provider')
  })

  it.concurrent('should use default featureType for simple unknown provider', () => {
    const config = parseProvider('unknown' as OAuthProvider)

    expect(config.baseProvider).toBe('unknown')
    expect(config.featureType).toBe('default')
  })

  it.concurrent('should parse OneDrive provider correctly', () => {
    const config = parseProvider('onedrive' as OAuthProvider)

    expect(config.baseProvider).toBe('microsoft')
    expect(config.featureType).toBe('onedrive')
  })

  it.concurrent('should parse SharePoint provider correctly', () => {
    const config = parseProvider('sharepoint' as OAuthProvider)

    expect(config.baseProvider).toBe('microsoft')
    expect(config.featureType).toBe('sharepoint')
  })
})

describe('getScopesForService', () => {
  it.concurrent('should return scopes for a valid serviceId', () => {
    const scopes = getScopesForService('gmail')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.send')
  })

  it.concurrent('should return empty array for unknown serviceId', () => {
    const scopes = getScopesForService('nonexistent-service')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })

  it.concurrent('should return new array instance (not reference)', () => {
    const scopes1 = getScopesForService('gmail')
    const scopes2 = getScopesForService('gmail')

    expect(scopes1).not.toBe(scopes2)
    expect(scopes1).toEqual(scopes2)
  })

  it.concurrent('should work for Microsoft services', () => {
    const scopes = getScopesForService('outlook')

    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes).toContain('Mail.ReadWrite')
  })

  it.concurrent('should return empty array for empty string', () => {
    const scopes = getScopesForService('')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })
})

describe('getMissingRequiredScopes', () => {
  it.concurrent('should return empty array when all scopes are granted', () => {
    const credential = { scopes: ['read', 'write'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'write'])

    expect(missing).toEqual([])
  })

  it.concurrent('should return missing scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'write'])

    expect(missing).toEqual(['write'])
  })

  it.concurrent('should return all required scopes when credential is undefined', () => {
    const missing = getMissingRequiredScopes(undefined, ['read', 'write'])

    expect(missing).toEqual(['read', 'write'])
  })

  it.concurrent('should return all required scopes when credential has undefined scopes', () => {
    const missing = getMissingRequiredScopes({ scopes: undefined }, ['read', 'write'])

    expect(missing).toEqual(['read', 'write'])
  })

  it.concurrent('should ignore offline_access in required scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'offline_access'])

    expect(missing).toEqual([])
  })

  it.concurrent('should ignore refresh_token in required scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'refresh_token'])

    expect(missing).toEqual([])
  })

  it.concurrent('should ignore offline.access in required scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'offline.access'])

    expect(missing).toEqual([])
  })

  it.concurrent('should filter ignored scopes even when credential is undefined', () => {
    const missing = getMissingRequiredScopes(undefined, ['read', 'offline_access', 'refresh_token'])

    expect(missing).toEqual(['read'])
  })

  it.concurrent('should return empty array when requiredScopes is empty', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, [])

    expect(missing).toEqual([])
  })

  it.concurrent('should return empty array when requiredScopes defaults to empty', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential)

    expect(missing).toEqual([])
  })
})
