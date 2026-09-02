/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry', () => {
  const icon = () => null
  return {
    CONNECTOR_META_REGISTRY: {
      mintlify: { id: 'mintlify', name: 'Mintlify', auth: { mode: 'apiKey' }, icon },
      jsm: {
        id: 'jsm',
        name: 'Jira Service Management',
        auth: { mode: 'oauth', provider: 'jira' },
        icon,
      },
      jira: { id: 'jira', name: 'Jira', auth: { mode: 'oauth', provider: 'jira' }, icon },
      google_drive: {
        id: 'google_drive',
        name: 'Google Drive',
        auth: { mode: 'oauth', provider: 'google-drive' },
        icon,
      },
      gmail: {
        id: 'gmail',
        name: 'Gmail',
        auth: { mode: 'oauth', provider: 'google-email' },
        icon,
      },
      unknown: {
        id: 'unknown',
        name: 'Unknown',
        auth: { mode: 'oauth', provider: 'not-a-service' },
        icon,
      },
      salesforce: {
        id: 'salesforce',
        name: 'Salesforce',
        auth: { mode: 'oauth', provider: 'salesforce' },
        icon,
      },
    },
  }
})

vi.mock('@/lib/oauth', () => {
  const services = {
    jira: { providerId: 'jira', name: 'Jira', icon: () => null },
    'google-drive': { providerId: 'google-drive', name: 'Google Drive', icon: () => null },
    gmail: { providerId: 'google-email', name: 'Gmail', icon: () => null },
    salesforce: {
      providerId: 'salesforce',
      name: 'Salesforce',
      icon: () => null,
      additionalProviderIds: ['salesforce-sandbox'],
    },
  }
  return {
    getServiceConfigByServiceId: (serviceId: string) =>
      services[serviceId as keyof typeof services] ?? null,
    getServiceConfigByProviderId: (providerId: string) =>
      Object.values(services).find((service) => service.providerId === providerId) ?? null,
    getCanonicalScopesForProvider: (providerId: string) => [`${providerId}:read`],
  }
})

vi.mock('@/lib/integrations/credential-display', () => ({
  getIntegrationsForCredentialProvider: (providerId: string) =>
    providerId === 'jira' ? [{ type: 'jira' }] : [],
}))

import {
  isSearchConnectorAvailable,
  isSearchConnectorConnected,
  isSearchConnectorProvider,
  SEARCH_CONNECTORS,
} from '@/lib/sim-search/connectors'

describe('SEARCH_CONNECTORS', () => {
  it('lists OAuth connectors with a registered service, alphabetically', () => {
    expect(SEARCH_CONNECTORS.map((connector) => connector.type)).toEqual([
      'gmail',
      'google_drive',
      'jira',
      'jsm',
      'salesforce',
    ])
  })

  it('resolves the provider, scopes, and brand block type per connector', () => {
    const jsm = SEARCH_CONNECTORS.find((connector) => connector.type === 'jsm')
    expect(jsm).toMatchObject({
      providerId: 'jira',
      providerIds: ['jira'],
      requiredScopes: ['jira:read'],
      serviceName: 'Jira',
      blockType: 'jira',
    })
    const drive = SEARCH_CONNECTORS.find((connector) => connector.type === 'google_drive')
    expect(drive).toMatchObject({ blockType: 'google_drive' })
    const gmail = SEARCH_CONNECTORS.find((connector) => connector.type === 'gmail')
    expect(gmail).toMatchObject({ providerId: 'google-email', serviceName: 'Gmail' })
  })
})

describe('isSearchConnectorProvider', () => {
  it('matches credentials by provider, including shared and additional providers', () => {
    expect(isSearchConnectorProvider('jira')).toBe(true)
    expect(isSearchConnectorProvider('google-drive')).toBe(true)
    expect(isSearchConnectorProvider('salesforce-sandbox')).toBe(true)
    expect(isSearchConnectorProvider('slack')).toBe(false)
    expect(isSearchConnectorProvider(null)).toBe(false)
  })
})

describe('isSearchConnectorConnected', () => {
  it('counts a credential under any of the service’s provider ids', () => {
    const salesforce = SEARCH_CONNECTORS.find((connector) => connector.type === 'salesforce')!
    expect(isSearchConnectorConnected(salesforce, new Set(['salesforce-sandbox']))).toBe(true)
    expect(isSearchConnectorConnected(salesforce, new Set(['jira']))).toBe(false)
  })
})

describe('isSearchConnectorAvailable', () => {
  it('reads the OAuth path of the connector’s block, defaulting to available', () => {
    const jira = SEARCH_CONNECTORS.find((connector) => connector.type === 'jira')!
    expect(isSearchConnectorAvailable(jira, new Map([['jira', { oauthAvailable: false }]]))).toBe(
      false
    )
    expect(isSearchConnectorAvailable(jira, new Map([['jira', { oauthAvailable: true }]]))).toBe(
      true
    )
    expect(isSearchConnectorAvailable(jira, new Map())).toBe(true)
  })
})
