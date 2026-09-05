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
    confluence: { providerId: 'confluence', name: 'Confluence', icon: () => null },
    slack: { providerId: 'slack', name: 'Slack', icon: () => null },
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
    providerId === 'jira'
      ? [{ type: 'jira' }]
      : providerId === 'slack'
        ? [{ type: 'slack_v2' }]
        : [],
}))

vi.mock('@/lib/credential-groups/providers', () => ({
  findCredentialGroupProviderFromProviderId: (providerId: string) =>
    ['google-drive', 'confluence', 'slack', 'jira', 'google-email', 'salesforce'].includes(
      providerId
    )
      ? providerId
      : null,
}))

import {
  canConnectPersonally,
  getConnectorAccessAvailability,
  isSearchConnectorAvailable,
  missingSetupFields,
  personalSetupFields,
  SEARCH_CONNECTORS,
} from '@/lib/sim-search/connectors'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

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

describe('getConnectorAccessAvailability', () => {
  const enabled = { memberAccessAvailable: true, mirroredAccessAvailable: true }
  const drive: ConnectorMeta = {
    id: 'google_drive',
    name: 'Google Drive',
    description: '',
    version: '1.0.0',
    icon: () => null,
    auth: { mode: 'oauth', provider: 'google-drive' },
    configFields: [],
    mirrorsSourceAcls: true,
    permissionScopedListing: { capFieldIds: [] },
  }
  const confluence: ConnectorMeta = {
    ...drive,
    id: 'confluence',
    name: 'Confluence',
    auth: { mode: 'oauth', provider: 'confluence' },
    requiresMemberIdentity: true,
  }

  it('preserves member and central choices for ordinary KBs without Search opt-in', () => {
    expect(getConnectorAccessAvailability(drive, new Map(), enabled)).toEqual({
      admin: true,
      members: true,
    })
  })

  it.each([
    [false, false, { admin: false, members: false }],
    [false, true, { admin: true, members: false }],
    [true, false, { admin: false, members: true }],
  ])(
    'respects independent member=%s and central=%s feature gates',
    (member, mirrored, expected) => {
      expect(
        getConnectorAccessAvailability(drive, new Map(), {
          memberAccessAvailable: member,
          mirroredAccessAvailable: mirrored,
        })
      ).toEqual(expected)
    }
  )

  it('keeps Drive central setup available with a service account when OAuth is unavailable', () => {
    expect(
      getConnectorAccessAvailability(
        drive,
        new Map([['google_drive', { state: 'limited', oauthAvailable: false }]]),
        enabled
      )
    ).toEqual({ admin: true, members: false })
  })

  it('refuses Confluence central setup on a service-account-only deployment', () => {
    expect(
      getConnectorAccessAvailability(
        confluence,
        new Map([['confluence', { state: 'limited', oauthAvailable: false }]]),
        enabled
      )
    ).toEqual({ admin: false, members: false })
  })

  it('refuses Confluence central setup when managed identity features are disabled', () => {
    expect(
      getConnectorAccessAvailability(confluence, new Map(), {
        memberAccessAvailable: false,
        mirroredAccessAvailable: true,
      })
    ).toEqual({ admin: false, members: false })
  })

  it('allows Confluence central setup once both identity and crawler paths are available', () => {
    expect(
      getConnectorAccessAvailability(
        confluence,
        new Map([['confluence', { state: 'ready', oauthAvailable: true }]]),
        enabled
      )
    ).toEqual({ admin: true, members: true })
  })

  it('does not require per-member crawling capability for an identity-only central source', () => {
    expect(
      getConnectorAccessAvailability(
        { ...confluence, permissionScopedListing: undefined },
        new Map(),
        enabled
      )
    ).toEqual({ admin: true, members: false })
  })

  it('keeps Slack custom-app setup available under its integration block alias', () => {
    const slack: ConnectorMeta = {
      ...drive,
      id: 'slack',
      auth: { mode: 'oauth', provider: 'slack' },
      mirrorsSourceAcls: undefined,
    }
    expect(
      getConnectorAccessAvailability(
        slack,
        new Map([['slack_v2', { state: 'limited', oauthAvailable: false }]]),
        enabled
      )
    ).toEqual({ admin: false, members: true })
  })

  it.each(['unavailable', 'misconfigured'] as const)(
    'refuses new source methods when deployment state is %s',
    (state) => {
      expect(
        getConnectorAccessAvailability(
          drive,
          new Map([['google_drive', { state, oauthAvailable: true }]]),
          enabled
        )
      ).toEqual({ admin: false, members: false })
    }
  )

  it('supports the GitLab central token path independently of OAuth or member features', () => {
    const gitlab: ConnectorMeta = {
      ...drive,
      id: 'gitlab',
      auth: { mode: 'apiKey' },
      permissionScopedListing: undefined,
    }
    expect(
      getConnectorAccessAvailability(
        gitlab,
        new Map([['gitlab', { state: 'ready', oauthAvailable: false }]]),
        { memberAccessAvailable: false, mirroredAccessAvailable: true }
      )
    ).toEqual({ admin: true, members: false })
  })

  it('does not offer identity-dependent methods for an unknown OAuth service', () => {
    expect(
      getConnectorAccessAvailability(
        { ...confluence, auth: { mode: 'oauth', provider: 'not-a-service' } },
        new Map(),
        enabled
      )
    ).toEqual({ admin: false, members: false })
  })
})
