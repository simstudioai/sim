/**
 * @vitest-environment node
 *
 * The generated metadata trails the live-search catalog. Failure mode: a live-search provider it has
 * not caught up with reading as a generic account, with the wrong guide and no resource to scope.
 */
import { SIM_DOCS_URL } from '@sim/utils/site'
import { describe, expect, it, vi } from 'vitest'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'

const { entries } = vi.hoisted(() => ({ entries: { current: [] as unknown[] } }))
vi.mock('@/platform/lib/integrations/metadata.generated', () => ({
  providerMetadata: [
    { id: 'documented', setupGuideUrl: 'https://docs.example/documented', searchResource: 'Pages' },
  ],
  memberSecretMetadata: {},
}))
vi.mock('@/lib/credential-groups/member-integrations', () => ({
  memberIntegrationEntries: () => entries.current,
}))

import {
  toCenterIntegrations,
  toOrganizationIntegrations,
} from '@/platform/lib/data/integrations-model'

function guideOf(provider: string) {
  const entry: Partial<MemberIntegration> = {
    id: provider,
    provider,
    name: provider,
    accounts: [],
    permissionAccountIds: [],
    reconnectAccountIds: [],
    ready: true,
  }
  entries.current = [entry]
  const [integration] = toOrganizationIntegrations({} as never, [])
  return { url: integration?.setupGuideUrl, resource: integration?.searchResource }
}

describe('an integration’s guide and resource', () => {
  it('gives a live-search provider missing from the metadata its own guide and label', () => {
    expect(guideOf('gmail')).toEqual({
      url: `${SIM_DOCS_URL}/search/gmail`,
      resource: LIVE_SEARCH_SCOPE_FIELDS.gmail?.label,
    })
  })

  it('gives any other unknown provider the general guide and no resource', () => {
    expect(guideOf('no_such_provider')).toEqual({
      url: `${SIM_DOCS_URL}/search/connect-your-account`,
      resource: null,
    })
  })

  it('prefers the metadata when it has an answer', () => {
    expect(guideOf('documented')).toEqual({
      url: 'https://docs.example/documented',
      resource: 'Pages',
    })
  })
})

const VIEWER = { id: 'viewer', name: 'Viewer' }

function centerOf(entry: Partial<MemberIntegration>) {
  entries.current = [
    {
      id: 'atlassian',
      provider: 'confluence',
      name: 'Confluence',
      accounts: [],
      permissionAccountIds: [],
      reconnectAccountIds: [],
      ready: true,
      ...entry,
    },
  ]
  const [integration] = toCenterIntegrations({} as never, [], VIEWER)
  return integration
}

const oauthAccount = {
  credentialId: 'oauth-1',
  displayName: 'me@example.com',
  providerId: 'confluence',
  groupId: 'group',
  optionId: 'option',
  status: 'active' as const,
  sites: [{ name: 'Engineering', url: 'https://eng.atlassian.net' }],
}

describe('the live inventory in the integration center', () => {
  it('offers no new credential when the organization blocks the app, and says why', () => {
    const integration = centerOf({
      ready: false,
      description: 'Paused by your organization',
      connectionTarget: { optionId: 'option' },
    })
    expect(integration).toMatchObject({
      availability: 'unavailable',
      canAddCredential: false,
      accessDescription: 'Paused by your organization',
    })
  })

  it('offers nothing to connect for an organization-managed source', () => {
    const integration = centerOf({ managed: true, connectionTarget: { optionId: 'option' } })
    expect(integration).toMatchObject({
      availability: 'managed',
      canAddCredential: false,
      connectableMethod: null,
      credentials: [],
    })
  })

  it('keeps each account as the viewer’s own credential, with the sites its grant reaches', () => {
    const [credential] = centerOf({
      accounts: [oauthAccount],
      reconnectAccountIds: ['oauth-1'],
    }).credentials
    expect(credential).toMatchObject({
      id: 'oauth-1',
      type: 'oauth',
      canReconnect: true,
      sites: oauthAccount.sites,
      scope: { kind: 'personal', ownerId: 'viewer' },
      members: [{ userId: 'viewer', role: 'admin', explicitAdmin: true }],
    })
  })

  it('tells a saved service account and a managed MCP account from an OAuth grant', () => {
    const integration = centerOf({
      accounts: [
        {
          credentialId: 'saved',
          displayName: 'Jama',
          providerId: 'jama-service-account',
          status: 'active',
        },
        { credentialId: 'mcp', displayName: 'Workspace', mcpServerId: 'server', status: 'active' },
      ] as MemberIntegration['accounts'],
    })
    expect(
      integration?.credentials.map(({ id, type, providerId }) => ({ id, type, providerId }))
    ).toEqual([
      { id: 'saved', type: 'service_account', providerId: 'jama-service-account' },
      { id: 'mcp', type: 'mcp', providerId: 'confluence' },
    ])
  })
})
