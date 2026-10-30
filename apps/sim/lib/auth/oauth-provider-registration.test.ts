import { oauthProvider } from '@better-auth/oauth-provider'
import { generateId } from '@sim/utils/id'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { symmetricEncrypt } from 'better-auth/crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  registerOAuthClientBodySchema,
  registerOAuthClientResponseSchema,
} from '@/lib/api/contracts/oauth-provider'
import { OAUTH_PUBLIC_REGISTRATION_SCOPES, OAUTH_SCOPES } from '@/lib/auth/oauth-provider'
import { OAUTH_AUTHORIZED_RESOURCE_PARAM } from '@/lib/auth/oauth-resource'

const BASE_URL = 'https://sim.test'
const AUTH_SECRET = 'isolated-oauth-registration-test-secret-123456789'
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback'
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const claudeMetadata = {
  client_name: 'Claude',
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: 'client_secret_post',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope: 'search:read offline_access',
  application_type: 'web',
}

function createProvider(
  database: Record<string, Record<string, unknown>[]>,
  issuedQueries: unknown[]
) {
  return betterAuth({
    baseURL: BASE_URL,
    secret: AUTH_SECRET,
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    plugins: [
      oauthProvider({
        loginPage: '/oauth/sign-in',
        consentPage: '/oauth/consent',
        disableJwtPlugin: true,
        scopes: [...OAUTH_SCOPES],
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        clientRegistrationAllowedScopes: [...OAUTH_PUBLIC_REGISTRATION_SCOPES],
        clientRegistrationDefaultScopes: [...OAUTH_PUBLIC_REGISTRATION_SCOPES],
        clientPrivileges: () => false,
        customTokenResponseFields: ({ verificationValue }) => {
          issuedQueries.push(verificationValue?.query)
          return {}
        },
        silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      }),
    ],
  })
}

describe('MCP client registration with the installed OAuth provider', () => {
  let database: Record<string, Record<string, unknown>[]>
  let provider: ReturnType<typeof createProvider>
  let issuedQueries: unknown[]

  beforeEach(() => {
    database = {
      user: [],
      session: [],
      account: [],
      verification: [],
      oauthClient: [],
      oauthConsent: [],
      oauthAccessToken: [],
      oauthRefreshToken: [],
    }
    issuedQueries = []
    provider = createProvider(database, issuedQueries)
  })

  async function register(metadata: object = claudeMetadata) {
    const body = registerOAuthClientBodySchema.parse(metadata)
    return provider.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, require_pkce: true }),
      })
    )
  }

  async function signIn() {
    const response = await provider.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({
          email: 'oauth-registration@example.com',
          name: 'OAuth registration test',
          password: 'isolated-user-test-password-123456789',
        }),
      })
    )
    expect(response.ok).toBe(true)
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ')
  }

  async function requestConsent(
    clientId: string,
    cookie: string,
    scope: string,
    extra: Record<string, string> = {}
  ) {
    const url = new URL(`${BASE_URL}/api/auth/oauth2/authorize`)
    url.search = new URLSearchParams({
      ...extra,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope,
      prompt: 'consent',
      state: 'registration-test',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    }).toString()
    const response = await provider.handler(new Request(url, { headers: { Cookie: cookie } }))
    const consentUrl = new URL(response.headers.get('location')!, BASE_URL)
    expect(consentUrl.pathname).toBe('/oauth/consent')
    return new URLSearchParams(consentUrl.search)
  }

  function submitConsent(oauthQuery: URLSearchParams, cookie: string) {
    return provider.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE_URL },
        body: JSON.stringify({ accept: true, oauth_query: oauthQuery.toString() }),
      })
    )
  }

  async function authorize(
    clientId: string,
    cookie: string,
    scope = 'search:read offline_access',
    extra: Record<string, string> = {}
  ) {
    const oauthQuery = await requestConsent(clientId, cookie, scope, extra)
    const consentResponse = await submitConsent(oauthQuery, cookie)
    expect(consentResponse.ok).toBe(true)
    const consent = await consentResponse.json()
    const callback = new URL(consent.url)
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI)
    expect(callback.searchParams.get('state')).toBe('registration-test')
    expect(callback.searchParams.has('error')).toBe(false)
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()
    return code!
  }

  function requestToken(body: Record<string, string>, headers: Record<string, string> = {}) {
    return provider.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(body),
      })
    )
  }

  it.each(['none', 'client_secret_basic', 'client_secret_post'])(
    'persists %s requests as public Search clients without a secret',
    async (authMethod) => {
      const response = await register({
        ...claudeMetadata,
        token_endpoint_auth_method: authMethod,
      })
      expect(response.ok).toBe(true)
      const body = await response.json()
      expect(registerOAuthClientResponseSchema.parse(body)).toMatchObject({
        client_name: 'Claude',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
      })
      expect(body).not.toHaveProperty('client_secret')
      expect(database.oauthClient).toHaveLength(1)
      expect(database.oauthClient[0]).toMatchObject({ tokenEndpointAuthMethod: 'none' })
      expect(database.oauthClient[0].clientSecret).toBeFalsy()
      expect(database.oauthClient[0].skipConsent).toBeFalsy()
      expect(database.oauthClient[0].userId).toBeFalsy()
    }
  )

  it.each(['http://127.0.0.1:43123/callback', 'cursor://anysphere.cursor-mcp/oauth/callback'])(
    'registers native MCP clients with the %s callback',
    async (redirectUri) => {
      const response = await register({ client_name: 'Native', redirect_uris: [redirectUri] })
      expect(response.status).toBe(201)
      expect(database.oauthClient[0]).toMatchObject({
        redirectUris: [redirectUri],
        tokenEndpointAuthMethod: 'none',
      })
    }
  )

  it('keeps registrable issuer scopes and strips privileged metadata before persistence', async () => {
    const response = await register({
      ...claudeMetadata,
      scope: 'api:read api:write search:read offline_access',
      client_secret: 'must-not-be-stored',
      public: false,
      skip_consent: true,
      require_pkce: false,
      metadata: { skip_consent: true },
    })
    expect(response.ok).toBe(true)
    expect(database.oauthClient[0]).toMatchObject({
      tokenEndpointAuthMethod: 'none',
      scopes: ['api:read', 'api:write', 'offline_access', 'search:read'],
    })
    expect(database.oauthClient[0].clientSecret).toBeFalsy()
    expect(database.oauthClient[0].skipConsent).toBeFalsy()
    expect(database.oauthClient[0].metadata).toBeFalsy()
  })

  it.each([undefined, 'openid'])(
    'rejects authorization without PKCE or with unregistered scope %s',
    async (scope) => {
      const registered = await register()
      const client = registerOAuthClientResponseSchema.parse(await registered.json())
      const url = new URL(`${BASE_URL}/api/auth/oauth2/authorize`)
      url.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: scope ?? 'search:read offline_access',
        state: 'registration-test',
      }).toString()
      const response = await provider.handler(new Request(url))
      const location = new URL(response.headers.get('location')!)
      expect(location.origin + location.pathname).toBe(REDIRECT_URI)
      expect(location.searchParams.get('error')).toBe(scope ? 'invalid_scope' : 'invalid_request')
      expect(location.searchParams.has('code')).toBe(false)
    }
  )

  it('continues negotiated public clients to sign-in with S256 PKCE', async () => {
    const registered = await register()
    const client = registerOAuthClientResponseSchema.parse(await registered.json())
    const url = new URL(`${BASE_URL}/api/auth/oauth2/authorize`)
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'search:read offline_access',
      state: 'registration-test',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    }).toString()
    const response = await provider.handler(new Request(url))
    const location = new URL(response.headers.get('location')!, BASE_URL)
    expect(location.origin + location.pathname).toBe(`${BASE_URL}/oauth/sign-in`)
    expect(location.searchParams.has('error')).toBe(false)
  })

  it.each(['none', 'client_secret_basic', 'client_secret_post'])(
    'completes consent, S256 token exchange, and refresh without a secret after requesting %s',
    async (authMethod) => {
      const registered = await register({
        ...claudeMetadata,
        token_endpoint_auth_method: authMethod,
      })
      const client = registerOAuthClientResponseSchema.parse(await registered.json())
      const cookie = await signIn()
      const code = await authorize(client.client_id, cookie)
      const tokenResponse = await requestToken({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: CODE_VERIFIER,
      })
      expect(tokenResponse.ok).toBe(true)
      const token = await tokenResponse.json()
      expect(token).toMatchObject({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        token_type: 'Bearer',
        scope: 'search:read offline_access',
      })
      expect(token).not.toHaveProperty('client_secret')
      const refreshed = await requestToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: token.refresh_token,
      })
      expect(refreshed.ok).toBe(true)
      const refreshedToken = await refreshed.json()
      expect(refreshedToken).toMatchObject({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        scope: 'search:read offline_access',
      })
      expect(refreshedToken.access_token).not.toBe(token.access_token)
      expect(refreshedToken.refresh_token).not.toBe(token.refresh_token)
      const escalation = await requestToken({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: refreshedToken.refresh_token,
        scope: 'api:write',
      })
      expect(escalation.ok).toBe(false)
      expect(await escalation.json()).not.toHaveProperty('access_token')
    }
  )

  it.each([undefined, 'wrong-code-verifier-with-at-least-43-characters'])(
    'rejects code exchange with verifier %s',
    async (verifier) => {
      const registered = await register()
      const client = registerOAuthClientResponseSchema.parse(await registered.json())
      const cookie = await signIn()
      const code = await authorize(client.client_id, cookie)
      const response = await requestToken({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code,
        ...(verifier ? { code_verifier: verifier } : {}),
      })
      expect(response.ok).toBe(false)
      expect(await response.json()).not.toHaveProperty('access_token')
      expect(database.oauthAccessToken ?? []).toHaveLength(0)
      expect(database.oauthRefreshToken ?? []).toHaveLength(0)
    }
  )

  it('carries the authorized resource through signed consent to the code exchange', async () => {
    const resource = `${BASE_URL}/api/mcp/search/organizations/org-one`
    const registered = await register()
    const client = registerOAuthClientResponseSchema.parse(await registered.json())
    const cookie = await signIn()
    const code = await authorize(client.client_id, cookie, 'search:read offline_access', {
      [OAUTH_AUTHORIZED_RESOURCE_PARAM]: resource,
    })
    const tokenResponse = await requestToken({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: CODE_VERIFIER,
    })
    expect(tokenResponse.ok).toBe(true)
    expect(issuedQueries).toEqual([
      expect.objectContaining({ [OAUTH_AUTHORIZED_RESOURCE_PARAM]: resource }),
    ])
  })

  it('refuses consent when the signed authorized resource is altered', async () => {
    const registered = await register()
    const client = registerOAuthClientResponseSchema.parse(await registered.json())
    const cookie = await signIn()
    const oauthQuery = await requestConsent(
      client.client_id,
      cookie,
      'search:read offline_access',
      {
        [OAUTH_AUTHORIZED_RESOURCE_PARAM]: `${BASE_URL}/api/mcp/search/organizations/org-one`,
      }
    )
    oauthQuery.set(
      OAUTH_AUTHORIZED_RESOURCE_PARAM,
      `${BASE_URL}/api/mcp/search/organizations/org-two`
    )
    const consentResponse = await submitConsent(oauthQuery, cookie)
    expect(consentResponse.ok).toBe(false)
    expect(database.verification.some((row) => String(row.value).includes('org-two'))).toBe(false)
  })

  it('preserves operator-created confidential clients and their API grants', async () => {
    const clientId = generateId()
    const clientSecret = 'isolated-confidential-client-secret'
    const context = await provider.$context
    await context.adapter.create({
      model: 'oauthClient',
      data: {
        clientId,
        clientSecret: await symmetricEncrypt({ key: AUTH_SECRET, data: clientSecret }),
        name: 'Operator-created test client',
        public: false,
        type: 'web',
        tokenEndpointAuthMethod: 'client_secret_basic',
        requirePKCE: true,
        skipConsent: false,
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        redirectUris: [REDIRECT_URI],
        scopes: ['api:read', 'offline_access'],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    await register()
    const cookie = await signIn()
    const code = await authorize(clientId, cookie, 'api:read offline_access')
    const tokenResponse = await requestToken(
      {
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: CODE_VERIFIER,
      },
      { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }
    )
    expect(tokenResponse.ok).toBe(true)
    const token = await tokenResponse.json()
    expect(token).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      scope: 'api:read offline_access',
    })
    const missingSecret = await requestToken({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: token.refresh_token,
    })
    expect(missingSecret.ok).toBe(false)
    expect(await missingSecret.json()).not.toHaveProperty('access_token')
    expect(database.oauthClient.find((client) => client.clientId === clientId)).toMatchObject({
      tokenEndpointAuthMethod: 'client_secret_basic',
      scopes: ['api:read', 'offline_access'],
    })
  })
})
