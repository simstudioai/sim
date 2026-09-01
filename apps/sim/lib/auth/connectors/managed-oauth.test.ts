/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAtlassianManagedOAuthConnector,
  getManagedOAuthConnectorPolicy,
} from '@/lib/auth/connectors/managed-oauth'

const ATLASSIAN_SCOPES = ['read:me', 'read:jira-work', 'offline_access']

describe('Atlassian managed OAuth connector', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the existing connector callback contract and verifies the current account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          account_type: 'atlassian',
          account_id: 'account-1',
          email: 'person@example.com',
          name: 'Person',
          picture: 'https://example.com/avatar.png',
          account_status: 'active',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const connector = createAtlassianManagedOAuthConnector('jira')

    const identity = await connector.verifyIdentity({
      tokens: {
        tokenType: 'Bearer',
        accessToken: 'access-1',
        scopes: ATLASSIAN_SCOPES,
      },
      clientId: 'client-1',
    })

    expect(connector).toMatchObject({
      requiresRefreshToken: true,
      pkce: false,
      nonceVerification: 'state_only',
      includeLoginHint: false,
      authorizationUrlParams: { audience: 'api.atlassian.com' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.atlassian.com/me',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer access-1',
        },
      })
    )
    expect(identity).toEqual({
      providerSubjectId: 'account-1',
      providerTenantId: null,
      email: 'person@example.com',
      emailVerified: true,
      displayName: 'Person',
      avatarUrl: 'https://example.com/avatar.png',
      grantedScopes: ATLASSIAN_SCOPES,
    })
  })

  it('fails closed for an inactive or incomplete Atlassian identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            account_type: 'atlassian',
            account_id: 'account-1',
            account_status: 'inactive',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    const connector = createAtlassianManagedOAuthConnector('confluence')

    await expect(
      connector.verifyIdentity({
        tokens: { accessToken: 'access-1', scopes: ATLASSIAN_SCOPES },
        clientId: 'client-1',
      })
    ).rejects.toThrow('Atlassian returned an invalid user identity')
  })

  it('fails before identity lookup when the token omits granted scopes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const connector = createAtlassianManagedOAuthConnector('jira')

    await expect(
      connector.verifyIdentity({
        tokens: { accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('Atlassian returned an incomplete authorization')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('binds policy identity to the product-specific Atlassian client', () => {
    const jira = createAtlassianManagedOAuthConnector('jira')
    const confluence = createAtlassianManagedOAuthConnector('confluence')

    expect(jira.getAuthorizationAppId('client-1')).toMatch(/^jira:[a-f0-9]{64}$/)
    expect(confluence.getAuthorizationAppId('client-1')).toMatch(/^confluence:[a-f0-9]{64}$/)
    expect(jira.isTerminalRefreshError('invalid_grant')).toBe(true)
    expect(jira.isTerminalRefreshError('temporarily_unavailable')).toBe(false)
  })
})

describe('userinfo-backed managed OAuth connectors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubProfile(profile: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function policyFor(providerId: string) {
    const policy = getManagedOAuthConnectorPolicy(providerId)
    if (!policy) throw new Error(`No managed OAuth policy registered for ${providerId}`)
    return policy
  }

  it.each([
    ['linkedin', { sub: 'sub-1', email: 'person@example.com', email_verified: false }],
    ['zoom', { id: 'zoom-1', email: 'person@example.com', verified: 0, account_id: 'account-1' }],
    ['dropbox', { account_id: 'dbid:1', email: 'person@example.com', email_verified: false }],
    ['pipedrive', { data: { id: 7, email: 'person@example.com', activated: false } }],
    ['wordpress', { ID: 12, email: 'person@example.com', email_verified: false }],
    ['salesforce', { user_id: 'sf-1', email: 'person@example.com', email_verified: false }],
  ])(
    'reports %s email verification from the provider rather than assuming it',
    async (providerId, profile) => {
      stubProfile(profile)

      const identity = await policyFor(providerId).verifyIdentity({
        tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })

      expect(identity.email).toBe('person@example.com')
      expect(identity.emailVerified).toBe(false)
    }
  )

  it.each([
    ['linkedin', { sub: 'sub-1', email: 'person@example.com', email_verified: true }],
    ['zoom', { id: 'zoom-1', email: 'person@example.com', verified: 1 }],
    ['dropbox', { account_id: 'dbid:1', email: 'person@example.com', email_verified: true }],
    ['pipedrive', { data: { id: 7, email: 'person@example.com', activated: true } }],
  ])('accepts a verified %s identity', async (providerId, profile) => {
    stubProfile(profile)

    const identity = await policyFor(providerId).verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity.emailVerified).toBe(true)
  })

  it('fails closed when the provider returns no email to bind the invitation to', async () => {
    stubProfile({ sub: 'sub-1' })

    await expect(
      policyFor('linkedin').verifyIdentity({
        tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('LinkedIn email')
  })

  it('fails closed when the identity request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))

    await expect(
      policyFor('zoom').verifyIdentity({
        tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('HTTP 401')
  })

  it('reads DocuSign granted scopes from userinfo and falls back to the token response', async () => {
    stubProfile({
      sub: 'ds-1',
      email: 'person@example.com',
      scope: 'signature extended',
      accounts: [{ account_id: 'acct-2', is_default: true }],
    })
    const fromProfile = await policyFor('docusign').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: ['signature'] },
      clientId: 'client-1',
    })
    expect(fromProfile.grantedScopes).toEqual(['signature', 'extended'])
    expect(fromProfile.providerTenantId).toBe('acct-2')

    stubProfile({ sub: 'ds-1', email: 'person@example.com', accounts: [] })
    const fromTokens = await policyFor('docusign').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: ['signature', 'extended'] },
      clientId: 'client-1',
    })
    expect(fromTokens.grantedScopes).toEqual(['signature', 'extended'])
  })

  it('falls back to the requested scope set for a provider that reports none', async () => {
    stubProfile({ ID: 12, email: 'person@example.com', email_verified: true })

    const identity = await policyFor('wordpress').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity.grantedScopes).toEqual(['global'])
    expect(policyFor('wordpress').hasRequiredScopes(identity.grantedScopes, ['global'])).toBe(true)
  })

  it('sends Salesforce identity lookups to the authorization server the provider id names', async () => {
    const fetchMock = stubProfile({
      user_id: 'sf-1',
      email: 'person@example.com',
      email_verified: true,
      organization_id: 'org-1',
    })

    const identity = await policyFor('salesforce').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: ['api'] },
      clientId: 'client-1',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://login.salesforce.com/services/oauth2/userinfo'
    )
    expect(identity.providerTenantId).toBe('org-1')
  })

  it('keeps a provider id that collides with an Object prototype member unresolved', () => {
    expect(getManagedOAuthConnectorPolicy('toString')).toBeUndefined()
    expect(getManagedOAuthConnectorPolicy('constructor')).toBeUndefined()
  })
  it('refuses a Notion integration that identifies a workspace rather than a person', async () => {
    stubProfile({ id: 'bot-1', bot: { owner: { type: 'workspace', workspace: true } } })

    await expect(
      policyFor('notion').verifyIdentity({
        tokens: { tokenType: 'bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('identifies no person')
  })

  it('reads the authorizing human behind a Notion integration token', async () => {
    stubProfile({
      id: 'bot-1',
      bot: {
        owner: {
          type: 'user',
          user: { id: 'user-1', name: 'Person', person: { email: 'person@example.com' } },
        },
      },
    })

    const identity = await policyFor('notion').verifyIdentity({
      tokens: { tokenType: 'bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity).toMatchObject({
      providerSubjectId: 'user-1',
      email: 'person@example.com',
      emailVerified: true,
    })
  })

  it.each(['notion', 'clickup', 'calcom'])(
    'declares %s scopeless so an empty scope policy is not read as a misconfiguration',
    (providerId) => {
      expect(policyFor(providerId).scopeless).toBe(true)
    }
  )

  it.each(['linear', 'monday'])(
    'treats a partial %s GraphQL response as no identity at all',
    async (providerId) => {
      stubProfile({ data: { viewer: null, me: null }, errors: [{ message: 'denied' }] })

      await expect(
        policyFor(providerId).verifyIdentity({
          tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
          clientId: 'client-1',
        })
      ).rejects.toThrow('invalid user identity')
    }
  )

  it('resolves the Attio member who authorized the token, not an arbitrary one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            active: true,
            workspace_id: 'workspace-1',
            authorized_by_workspace_member_id: 'member-2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: { workspace_id: 'workspace-1', workspace_member_id: 'member-2' },
              first_name: 'Person',
              last_name: 'Example',
              email_address: 'person@example.com',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const identity = await policyFor('attio').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: ['user_management:read'] },
      clientId: 'client-1',
    })

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.attio.com/v2/workspace_members/member-2')
    expect(identity).toMatchObject({
      providerSubjectId: 'member-2',
      email: 'person@example.com',
      providerTenantId: 'workspace-1',
      displayName: 'Person Example',
    })
  })

  it('identifies a HubSpot seat through the token-metadata endpoint', async () => {
    const fetchMock = stubProfile({
      user_id: 42,
      user: 'person@example.com',
      hub_id: 7,
      scopes: ['crm.objects.contacts.read'],
    })

    const identity = await policyFor('hubspot').verifyIdentity({
      tokens: { tokenType: 'bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.hubapi.com/oauth/v1/access-tokens/access-1'
    )
    expect(identity).toMatchObject({
      providerSubjectId: '42',
      email: 'person@example.com',
      providerTenantId: '7',
      grantedScopes: ['crm.objects.contacts.read'],
    })
  })

  it('takes Airtable granted scopes from whoami when the token response reports none', async () => {
    stubProfile({ id: 'usr1', email: 'person@example.com', scopes: ['data.records:read'] })

    const identity = await policyFor('airtable').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity.grantedScopes).toEqual(['data.records:read'])
  })
})
