/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry', () => {
  const icon = () => null
  return {
    CONNECTOR_META_REGISTRY: {
      mintlify: { id: 'mintlify', name: 'Mintlify', auth: { mode: 'apiKey' }, icon },
      unreviewed: {
        id: 'unreviewed',
        name: 'Unreviewed',
        auth: { mode: 'oauth', provider: 'jira' },
        permissionScopedListing: { capFieldIds: [] },
        mirrorsSourceAcls: true,
        configFields: [],
        icon,
      },
      jsm: {
        id: 'jsm',
        name: 'Jira Service Management',
        auth: { mode: 'oauth', provider: 'jira' },
        configFields: [],
        icon,
      },
      jira: {
        id: 'jira',
        search: true,
        name: 'Jira',
        auth: { mode: 'oauth', provider: 'jira' },
        permissionScopedListing: { capFieldIds: ['maxIssues'] },
        configFields: [{ id: 'domain', required: true }],
        icon,
      },
      google_drive: {
        id: 'google_drive',
        search: true,
        name: 'Google Drive',
        auth: { mode: 'oauth', provider: 'google-drive' },
        permissionScopedListing: { capFieldIds: ['maxFiles'] },
        configFields: [{ id: 'maxFiles', required: false }],
        icon,
      },
      gmail: {
        id: 'gmail',
        name: 'Gmail',
        auth: { mode: 'oauth', provider: 'google-email' },
        configFields: [],
        icon,
      },
      unknown: {
        id: 'unknown',
        name: 'Unknown',
        auth: { mode: 'oauth', provider: 'not-a-service' },
        configFields: [],
        icon,
      },
      salesforce: {
        id: 'salesforce',
        name: 'Salesforce',
        auth: { mode: 'oauth', provider: 'salesforce' },
        configFields: [],
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
  canConnectPersonally,
  isSearchConnectorAvailable,
  MANAGED_SEARCH_CONNECTORS,
  missingSetupFields,
  personalSetupFields,
  SEARCH_CONNECTORS,
} from '@/lib/sim-search/connectors'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

describe('SEARCH_CONNECTORS', () => {
  it('lists only permission-scoped OAuth connectors, alphabetically', () => {
    expect(SEARCH_CONNECTORS.map((connector) => connector.type)).toEqual(['google_drive', 'jira'])
  })

  it('resolves the provider, scopes, and brand block type per connector', () => {
    const jira = SEARCH_CONNECTORS.find((connector) => connector.type === 'jira')
    expect(jira).toMatchObject({
      providerId: 'jira',
      providerIds: ['jira'],
      requiredScopes: ['jira:read'],
      serviceName: 'Jira',
      blockType: 'jira',
    })
    const drive = SEARCH_CONNECTORS.find((connector) => connector.type === 'google_drive')
    expect(drive).toMatchObject({ blockType: 'google_drive' })
    expect(SEARCH_CONNECTORS.find((connector) => connector.type === 'jsm')).toBeUndefined()
  })
})

describe('canConnectPersonally', () => {
  it('requires explicit Search opt-in independently of connector ACL capabilities', () => {
    expect(canConnectPersonally(CONNECTOR_META_REGISTRY.unreviewed)).toBe(false)
    expect(SEARCH_CONNECTORS.some((source) => source.type === 'unreviewed')).toBe(false)
    expect(MANAGED_SEARCH_CONNECTORS.some((source) => source.type === 'unreviewed')).toBe(false)
  })
  it('offers personal connection to OAuth sources whose listing is permission-scoped', () => {
    const drive = SEARCH_CONNECTORS.find((connector) => connector.type === 'google_drive')!
    const jira = SEARCH_CONNECTORS.find((connector) => connector.type === 'jira')!
    expect(canConnectPersonally(drive.meta)).toBe(true)
    expect(canConnectPersonally(jira.meta)).toBe(true)
    expect(canConnectPersonally(CONNECTOR_META_REGISTRY.gmail)).toBe(false)
  })
})

describe('personalSetupFields', () => {
  it('asks for required config beyond the listing caps, never a selector', () => {
    const drive = SEARCH_CONNECTORS.find((connector) => connector.type === 'google_drive')!
    const jira = SEARCH_CONNECTORS.find((connector) => connector.type === 'jira')!
    expect(personalSetupFields(drive.meta)).toEqual([])
    expect(personalSetupFields(jira.meta).map((field) => field.id)).toEqual(['domain'])
  })

  it('reports the setup fields a config leaves empty', () => {
    const jira = SEARCH_CONNECTORS.find((connector) => connector.type === 'jira')!
    expect(missingSetupFields(jira.meta, {}).map((field) => field.id)).toEqual(['domain'])
    expect(missingSetupFields(jira.meta, { domain: '  ' })).toHaveLength(1)
    expect(missingSetupFields(jira.meta, { domain: 'acme.atlassian.net' })).toEqual([])
  })
})

describe('isSearchConnectorAvailable', () => {
  it('allows Slack custom-app authorization on limited deployments but respects unavailable states', () => {
    const sample = SEARCH_CONNECTORS[0]
    const slack = { ...sample, type: 'slack', blockType: 'slack_v2' }
    expect(
      isSearchConnectorAvailable(
        slack,
        new Map([['slack_v2', { oauthAvailable: false, state: 'limited' }]])
      )
    ).toBe(true)
    for (const state of ['unavailable', 'misconfigured'] as const) {
      expect(
        isSearchConnectorAvailable(slack, new Map([['slack_v2', { oauthAvailable: true, state }]]))
      ).toBe(false)
    }
  })

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
