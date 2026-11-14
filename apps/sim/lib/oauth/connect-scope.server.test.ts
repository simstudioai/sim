import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { validateAuthorizationCode } from 'better-auth/oauth2'
import { type GenericOAuthConfig, genericOAuth } from 'better-auth/plugins'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetActiveConnectDraft, mockGetOAuthState } = vi.hoisted(() => ({
  mockGetActiveConnectDraft: vi.fn(),
  mockGetOAuthState: vi.fn(),
}))
const { mockLoadWorkspaceApplicationContext } = workspaceContextMockFns

vi.mock('better-auth/api', () => ({ getOAuthState: mockGetOAuthState }))
vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
vi.mock('@/lib/credentials/connect-draft', () => ({
  getActiveConnectDraft: mockGetActiveConnectDraft,
}))
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)

import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import {
  resolveConnectDraftOutboundScope,
  withConnectDraftOutboundScope,
} from '@/lib/oauth/connect-scope.server'

async function organizationSeenByVendorCall(
  draftOwner: { workspaceId: string | null; organizationId: string | null },
  requestedProviderId: string
): Promise<string | null | undefined> {
  mockGetActiveConnectDraft.mockResolvedValue({
    id: 'draft-1',
    providerId: 'instagram',
    ...draftOwner,
  })
  const inDraftScope = await resolveConnectDraftOutboundScope({
    draftId: 'draft-1',
    userId: 'user-1',
    providerId: requestedProviderId,
  })
  let organizationId: string | null | undefined
  networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(async (id) => {
    organizationId = id
    return { kind: 'direct' }
  })
  await inDraftScope(() => resolveCurrentOutboundRoute())
  return organizationId
}

describe('resolveConnectDraftOutboundScope', () => {
  beforeEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
    mockLoadWorkspaceApplicationContext.mockResolvedValue(
      createMockWorkspaceApplicationContext({
        workspaceId: 'workspace-1',
        workspaceOrganizationId: 'org-1',
      })
    )
  })

  afterEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
  })

  it("routes vendor calls through the draft workspace's organization", async () => {
    await expect(
      organizationSeenByVendorCall(
        { workspaceId: 'workspace-1', organizationId: null },
        'instagram'
      )
    ).resolves.toBe('org-1')
    expect(mockGetActiveConnectDraft).toHaveBeenCalledWith('draft-1', 'user-1')
  })

  it('leaves vendor calls unscoped when the draft belongs to another provider', async () => {
    await expect(
      organizationSeenByVendorCall({ workspaceId: 'workspace-1', organizationId: null }, 'trello')
    ).resolves.toBeUndefined()
  })
})

describe('withConnectDraftOutboundScope', () => {
  beforeEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
  })

  afterEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
  })

  it("runs a generic connector's code exchange in its connect draft's organization", async () => {
    mockGetOAuthState.mockResolvedValue({
      callbackURL: '/workspace/ws-1/integrations?credentialDraftId=draft-1',
      link: { userId: 'user-1', email: 'user@example.com' },
    })
    mockGetActiveConnectDraft.mockResolvedValue({
      id: 'draft-1',
      providerId: 'jira',
      workspaceId: null,
      organizationId: 'org-1',
    })
    let organizationId: string | null | undefined
    networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(async (id) => {
      organizationId = id
      return { kind: 'direct' }
    })
    const connector = withConnectDraftOutboundScope({
      providerId: 'jira',
      clientId: 'client',
      getToken: async () => {
        await resolveCurrentOutboundRoute()
        return { accessToken: 'token' }
      },
    })

    await connector.getToken?.({ code: 'code', redirectURI: 'https://sim.test/callback' })

    expect(organizationId).toBe('org-1')
    expect(mockGetActiveConnectDraft).toHaveBeenCalledWith('draft-1', 'user-1')
  })
})

const TOKEN_RESPONSE = {
  token_type: 'Bearer',
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  scope: 'openid email',
}
const CODE = { code: 'code-1', redirectURI: 'https://sim.test/api/auth/oauth2/callback/idp' }
type CodeData = typeof CODE & { codeVerifier?: string }

interface RecordedRequest {
  url: string
  method: string
  redirect: string
  headers: Record<string, string>
  body: string
}

/** Records every request sent through the global `fetch`, the transport of both exchanges. */
function stubVendor(respond: (url: string) => Response = () => Response.json(TOKEN_RESPONSE)) {
  const requests: RecordedRequest[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push({
      url: request.url,
      method: request.method,
      redirect: request.redirect,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    })
    return respond(request.url)
  })
  return requests
}

/** The exchange Better Auth's generic OAuth plugin performs for a configured connector. */
async function pluginExchange(config: GenericOAuthConfig, data: CodeData) {
  const initialized = await genericOAuth({ config: [config] }).init?.({
    socialProviders: [],
  } as never)
  const provider = initialized?.context?.socialProviders?.[0]
  if (!provider) throw new Error('generic OAuth provider was not registered')
  return provider.validateAuthorizationCode(data)
}

async function compareExchanges(
  config: GenericOAuthConfig,
  data: CodeData,
  respond?: (url: string) => Response
) {
  const betterAuthRequests = stubVendor(respond)
  const betterAuthTokens = await pluginExchange(config, data)
  const routedRequests = stubVendor(respond)
  const routedTokens = await pluginExchange(withConnectDraftOutboundScope(config), data)
  return { betterAuthRequests, betterAuthTokens, routedRequests, routedTokens }
}

describe('default code exchange for connectors without getToken', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
    mockGetOAuthState.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
  })

  const base = {
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectURI: 'https://sim.test/api/auth/oauth2/callback/idp',
  }

  it.each<[string, GenericOAuthConfig, CodeData]>([
    [
      'basic client authentication with PKCE',
      {
        ...base,
        providerId: 'microsoft-teams',
        tokenUrl: 'https://login.idp.test/common/oauth2/v2.0/token',
        authentication: 'basic',
        pkce: true,
      },
      { ...CODE, codeVerifier: 'verifier-1' },
    ],
    [
      'post client authentication with custom headers and a default expiry',
      {
        ...base,
        providerId: 'hubspot',
        tokenUrl: 'https://api.idp.test/oauth/v1/token',
        authentication: 'post',
        authorizationHeaders: { 'x-tenant': 'tenant-1' },
        accessTokenExpiresIn: 7200,
      },
      CODE,
    ],
    [
      'a token endpoint resolved from discovery',
      {
        ...base,
        providerId: 'google-email',
        discoveryUrl: 'https://accounts.idp.test/.well-known/openid-configuration',
        discoveryHeaders: { 'x-discovery': '1' },
      },
      CODE,
    ],
  ])('sends the request Better Auth sends for %s', async (_label, config, data) => {
    const respond = (url: string) =>
      url.endsWith('openid-configuration')
        ? Response.json({ token_endpoint: 'https://oauth2.idp.test/token' })
        : Response.json(
            config.accessTokenExpiresIn
              ? { ...TOKEN_RESPONSE, expires_in: undefined }
              : TOKEN_RESPONSE
          )
    const result = await compareExchanges(config, data, respond)

    expect(result.routedRequests.length).toBeGreaterThan(0)
    expect(result.routedRequests).toEqual(result.betterAuthRequests)
    expect(result.routedTokens).toEqual(result.betterAuthTokens)
  })

  it("sends a connector's static token parameters the way Better Auth's callback does", async () => {
    const tokenUrl = 'https://idp.test/token'
    const tokenUrlParams = { audience: 'api.idp.test', grant_type: 'ignored' }
    const config: GenericOAuthConfig = { ...base, providerId: 'idp', tokenUrl, tokenUrlParams }
    const betterAuthRequests = stubVendor()
    await validateAuthorizationCode({
      headers: config.authorizationHeaders,
      ...CODE,
      options: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectURI: config.redirectURI,
      },
      tokenEndpoint: tokenUrl,
      authentication: config.authentication,
      additionalParams: tokenUrlParams,
    })
    const routedRequests = stubVendor()
    await withConnectDraftOutboundScope(config).getToken?.(CODE)

    expect(routedRequests).toEqual(betterAuthRequests)
  })

  it.each([
    ['an error status', () => Response.json({ error: 'invalid_grant' }, { status: 400 })],
    [
      'a redirect',
      () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    ],
  ])('fails the exchange on %s like Better Auth does', async (_label, respond) => {
    const config: GenericOAuthConfig = {
      ...base,
      providerId: 'idp',
      tokenUrl: 'https://idp.test/token',
    }
    stubVendor(respond)
    await expect(pluginExchange(config, CODE)).rejects.toThrow()
    stubVendor(respond)
    await expect(pluginExchange(withConnectDraftOutboundScope(config), CODE)).rejects.toThrow()
  })

  it("runs the default exchange in the connect draft's organization", async () => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
    mockGetOAuthState.mockResolvedValue({
      callbackURL: '/workspace/ws-1/integrations?credentialDraftId=draft-1',
      link: { userId: 'user-1', email: 'user@example.com' },
    })
    mockGetActiveConnectDraft.mockResolvedValue({
      id: 'draft-1',
      providerId: 'microsoft-teams',
      workspaceId: null,
      organizationId: 'org-1',
    })
    const routedOrganizations: Array<string | null | undefined> = []
    networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(async (id) => {
      routedOrganizations.push(id)
      return { kind: 'direct' }
    })
    stubVendor()
    const connector = withConnectDraftOutboundScope({
      ...base,
      providerId: 'microsoft-teams',
      tokenUrl: 'https://login.idp.test/common/oauth2/v2.0/token',
      authentication: 'basic',
    })

    await expect(connector.getToken?.(CODE)).resolves.toMatchObject({ accessToken: 'access-1' })
    expect(routedOrganizations).toEqual(['org-1'])
  })
})
