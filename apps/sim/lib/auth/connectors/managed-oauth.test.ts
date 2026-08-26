/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAtlassianManagedOAuthConnector } from '@/lib/auth/connectors/managed-oauth'

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
