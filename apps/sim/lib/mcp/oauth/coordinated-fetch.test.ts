/**
 * @vitest-environment node
 */
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { encryptionMock, redisConfigMockFns, resetRedisConfigMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoordinatedMcpOauthFetch } from '@/lib/mcp/oauth/coordinated-fetch'
import { withMcpOauthRefreshLock } from '@/lib/mcp/oauth/storage'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const SERVER = 'https://mcp.example.com/mcp'
const TOKEN_URL = 'https://auth.example.com/token'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function createGrant() {
  let persisted: OAuthTokens | undefined = {
    access_token: 'access-0',
    refresh_token: 'refresh-0',
    token_type: 'Bearer',
    scope: 'read',
  }
  let generation = 0
  const save = vi.fn(async (tokens: OAuthTokens | undefined) => {
    persisted = tokens
  })
  const redirect = vi.fn(async (_url: URL) => {
    throw new Error('Reauthorization required')
  })
  const createProvider = (): OAuthClientProvider => {
    let snapshot = persisted && { ...persisted }
    return {
      redirectUrl: 'https://sim.example.com/callback',
      clientMetadata: { redirect_uris: ['https://sim.example.com/callback'] },
      clientInformation: () => ({ client_id: 'test-client' }),
      tokens: () => snapshot,
      saveTokens: async (tokens) => {
        await save(tokens)
        snapshot = tokens
      },
      invalidateCredentials: async (scope) => {
        if (scope === 'all' || scope === 'tokens') {
          await save(undefined)
          snapshot = undefined
        }
      },
      redirectToAuthorization: redirect,
      saveCodeVerifier: async () => {},
      codeVerifier: () => 'verifier',
      discoveryState: () => ({
        authorizationServerUrl: new URL('https://auth.example.com'),
        resourceMetadata: { resource: SERVER, authorization_servers: ['https://auth.example.com'] },
        authorizationServerMetadata: {
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: TOKEN_URL,
          response_types_supported: ['code'],
          token_endpoint_auth_methods_supported: ['none'],
          code_challenge_methods_supported: ['S256'],
        },
      }),
    }
  }
  const loadProvider = vi.fn(async () => createProvider())
  const tokenRequest = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body))
    if (form.get('refresh_token') !== `refresh-${generation}`) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    generation++
    return Response.json({
      access_token: `access-${generation}`,
      refresh_token: `refresh-${generation}`,
      token_type: 'Bearer',
      scope: form.get('scope') ?? 'read',
    })
  })
  return { loadProvider, tokenRequest, save, redirect, createProvider }
}

function rejection(status = 401, challenge = 'Bearer error="invalid_token"') {
  return new Response(null, { status, headers: { 'www-authenticate': challenge } })
}

describe('coordinated MCP OAuth with the real SDK and refresh mutex', () => {
  const clients: Client[] = []

  beforeEach(() => {
    resetRedisConfigMock()
    vi.clearAllMocks()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    redisConfigMockFns.mockExtendLock.mockResolvedValue(true)
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    resetRedisConfigMock()
  })

  async function connect(grant: ReturnType<typeof createGrant>, request: FetchLike) {
    const client = new Client({ name: 'test', version: '1' }, { capabilities: {} })
    clients.push(client)
    const transport = new StreamableHTTPClientTransport(new URL(SERVER), {
      fetch: createCoordinatedMcpOauthFetch(
        {
          credentialId: 'shared-grant',
          loadProvider: grant.loadProvider,
          initialProvider: grant.createProvider(),
        },
        {
          serverUrl: SERVER,
          fetch: async (url, init) => {
            if (String(url) === TOKEN_URL) return grant.tokenRequest(url, init)
            if (init?.method === 'GET') return new Response(null, { status: 405 })
            const rpc = JSON.parse(String(init?.body))
            if (rpc.method === 'initialize') {
              return Response.json({
                jsonrpc: '2.0',
                id: rpc.id,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1' },
                },
              })
            }
            if (!('id' in rpc)) return new Response(null, { status: 202 })
            return request(url, init)
          },
        }
      ),
    })
    await client.connect(transport)
    return client
  }

  it('allows two tool calls to run concurrently without acquiring the OAuth mutex', async () => {
    const grant = createGrant()
    const bothStarted = deferred()
    const finish = deferred()
    let started = 0
    const request: FetchLike = async (_url, init) => {
      if (++started === 2) bothStarted.resolve()
      await finish.promise
      const rpc = JSON.parse(String(init?.body))
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { content: [] } })
    }
    const first = await connect(grant, request)
    const second = await connect(grant, request)
    const calls = Promise.all([first.callTool({ name: 'slow' }), second.callTool({ name: 'slow' })])
    try {
      await bothStarted.promise
      expect(redisConfigMockFns.mockAcquireLock).not.toHaveBeenCalled()
      expect(grant.tokenRequest).not.toHaveBeenCalled()
    } finally {
      finish.resolve()
      await calls
    }
  })

  it.each([false, true])(
    'refreshes once for concurrent 401s (shared client: %s)',
    async (shared) => {
      const grant = createGrant()
      const request: FetchLike = async (_url, init) => {
        if (new Headers(init?.headers).get('authorization') !== 'Bearer access-1')
          return rejection()
        const rpc = JSON.parse(String(init?.body))
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { content: [] } })
      }
      const first = await connect(grant, request)
      const second = shared ? first : await connect(grant, request)
      const results = await Promise.all([
        first.callTool({ name: 'read' }),
        second.callTool({ name: 'read' }),
      ])
      expect(results).toHaveLength(2)
      expect(grant.tokenRequest).toHaveBeenCalledTimes(1)
      expect(grant.save).toHaveBeenCalledTimes(1)
      expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledTimes(2)
    }
  )

  it('reuses a concurrently refreshed token when the OAuth response omits optional scope', async () => {
    const grant = createGrant()
    grant.tokenRequest.mockResolvedValueOnce(
      Response.json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        token_type: 'Bearer',
      })
    )
    const request: FetchLike = async (_url, init) => {
      if (new Headers(init?.headers).get('authorization') !== 'Bearer access-1') {
        return rejection(401, 'Bearer error="invalid_token", scope="read"')
      }
      const rpc = JSON.parse(String(init?.body))
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { content: [] } })
    }
    const first = await connect(grant, request)
    const second = await connect(grant, request)
    await Promise.all([first.callTool({ name: 'read' }), second.callTool({ name: 'read' })])
    expect(grant.tokenRequest).toHaveBeenCalledTimes(1)
  })

  function fetchFor(grant: ReturnType<typeof createGrant>, request: FetchLike) {
    return createCoordinatedMcpOauthFetch(
      {
        credentialId: 'shared-grant',
        loadProvider: grant.loadProvider,
        initialProvider: grant.createProvider(),
      },
      {
        serverUrl: SERVER,
        fetch: (url, init) =>
          String(url) === TOKEN_URL ? grant.tokenRequest(url, init) : request(url, init),
      }
    )
  }

  it('holds the mutex through token persistence and reuses the committed token', async () => {
    const grant = createGrant()
    const saving = deferred()
    const finishSave = deferred()
    const persist = grant.save.getMockImplementation()!
    grant.save.mockImplementationOnce(async (tokens) => {
      saving.resolve()
      await finishSave.promise
      await persist(tokens)
    })
    const rejected = deferred()
    let requests = 0
    const request: FetchLike = async (_url, init) => {
      if (new Headers(init?.headers).get('authorization') === 'Bearer access-1') {
        return new Response(null, { status: 202 })
      }
      if (++requests === 2) rejected.resolve()
      return rejection()
    }
    const first = fetchFor(grant, request)
    const second = fetchFor(grant, request)
    const calls = Promise.all([first(SERVER), second(SERVER)])
    try {
      await Promise.all([saving.promise, rejected.promise])
      expect(redisConfigMockFns.mockReleaseLock).not.toHaveBeenCalled()
      expect(grant.loadProvider).toHaveBeenCalledTimes(1)
    } finally {
      finishSave.resolve()
    }
    expect((await calls).map((r) => r.status)).toEqual([202, 202])
    expect(grant.tokenRequest).toHaveBeenCalledTimes(1)
  })

  it('does not block another credential while one credential refreshes', async () => {
    const slowGrant = createGrant()
    const otherGrant = createGrant()
    const refreshing = deferred()
    const finish = deferred()
    const exchange = slowGrant.tokenRequest.getMockImplementation()!
    slowGrant.tokenRequest.mockImplementationOnce(async (url, init) => {
      refreshing.resolve()
      await finish.promise
      return exchange(url, init)
    })
    const request: FetchLike = async (_url, init) =>
      new Headers(init?.headers).get('authorization') === 'Bearer access-1'
        ? new Response(null, { status: 202 })
        : rejection()
    const slow = fetchFor(slowGrant, request)(SERVER)
    try {
      await refreshing.promise
      const other = createCoordinatedMcpOauthFetch(
        {
          credentialId: 'other-grant',
          loadProvider: otherGrant.loadProvider,
          initialProvider: otherGrant.createProvider(),
        },
        {
          serverUrl: SERVER,
          fetch: (url, init) =>
            String(url) === TOKEN_URL ? otherGrant.tokenRequest(url, init) : request(url, init),
        }
      )
      expect((await other(SERVER)).status).toBe(202)
      expect(slowGrant.save).not.toHaveBeenCalled()
    } finally {
      finish.resolve()
      await slow
    }
  })

  it('returns streaming responses without buffering or replaying their bodies', async () => {
    const grant = createGrant()
    const response = new Response(new ReadableStream(), {
      headers: { 'content-type': 'text/event-stream' },
    })
    const request = vi.fn<FetchLike>().mockResolvedValue(response)
    const received = await fetchFor(grant, request)(SERVER)
    expect(received).toBe(response)
    expect(received.bodyUsed).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(redisConfigMockFns.mockAcquireLock).not.toHaveBeenCalled()
    await received.body?.cancel()
  })

  it('bounds retries even if the server keeps changing its scope challenge', async () => {
    const grant = createGrant()
    let scopes = 0
    const request = vi.fn<FetchLike>(async () =>
      rejection(403, `Bearer error="insufficient_scope", scope="scope-${++scopes}"`)
    )
    expect((await fetchFor(grant, request)(SERVER)).status).toBe(403)
    expect(request).toHaveBeenCalledTimes(4)
    expect(grant.tokenRequest).toHaveBeenCalledTimes(3)
  })

  it('coordinates authentication during initialization and GET stream reconnection too', async () => {
    const grant = createGrant()
    const request = vi.fn<FetchLike>(async (_url, init) =>
      new Headers(init?.headers).get('authorization') === 'Bearer access-1'
        ? new Response(null, { status: 202 })
        : rejection()
    )
    const first = fetchFor(grant, request)
    const second = fetchFor(grant, request)
    const responses = await Promise.all([
      first(SERVER, { method: 'POST', body: '{"method":"initialize"}' }),
      second(SERVER, { method: 'GET', headers: { 'last-event-id': 'event-1' } }),
    ])
    expect(responses.map((r) => r.status)).toEqual([202, 202])
    expect(grant.tokenRequest).toHaveBeenCalledTimes(1)
    const retry = request.mock.calls.find(
      ([, init]) =>
        init?.method === 'GET' &&
        new Headers(init.headers).get('authorization') === 'Bearer access-1'
    )
    expect(new Headers(retry?.[1]?.headers).get('last-event-id')).toBe('event-1')
  })

  it('does not replay an ordinary forbidden response or an uncertain network failure', async () => {
    const grant = createGrant()
    const request = vi.fn<FetchLike>().mockResolvedValueOnce(new Response(null, { status: 403 }))
    const guarded = fetchFor(grant, request)
    expect((await guarded(SERVER)).status).toBe(403)
    request.mockRejectedValueOnce(new Error('connection reset'))
    await expect(guarded(SERVER)).rejects.toThrow('connection reset')
    expect(request).toHaveBeenCalledTimes(2)
    expect(grant.tokenRequest).not.toHaveBeenCalled()
    expect(redisConfigMockFns.mockAcquireLock).not.toHaveBeenCalled()
  })

  it('stops after one authentication attempt if the server keeps rejecting the token', async () => {
    const grant = createGrant()
    const request = vi.fn<FetchLike>(async () => rejection())
    expect((await fetchFor(grant, request)(SERVER)).status).toBe(401)
    expect(request).toHaveBeenCalledTimes(2)
    expect(grant.tokenRequest).toHaveBeenCalledTimes(1)
  })

  it('allows a scope challenge after recovering from an expired token', async () => {
    const grant = createGrant()
    const request = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rejection())
      .mockResolvedValueOnce(
        rejection(403, 'Bearer error="insufficient_scope", scope="read write"')
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    expect((await fetchFor(grant, request)(SERVER)).status).toBe(202)
    expect(request).toHaveBeenCalledTimes(3)
    expect(grant.tokenRequest).toHaveBeenCalledTimes(2)
  })

  it('retains request headers and body when recovering from an insufficient-scope challenge', async () => {
    const grant = createGrant()
    const request = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        rejection(403, 'Bearer error="insufficient_scope", scope="read write"')
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    const body = '{"method":"tools/call","params":{"name":"write"}}'
    const response = await fetchFor(grant, request)(SERVER, {
      method: 'POST',
      body,
      headers: { 'mcp-session-id': 'session-1', 'x-sim-via': 'workflow-1' },
    })
    expect(response.status).toBe(202)
    expect(request.mock.calls[1][1]?.body).toBe(body)
    const headers = new Headers(request.mock.calls[1][1]?.headers)
    expect(headers.get('mcp-session-id')).toBe('session-1')
    expect(headers.get('x-sim-via')).toBe('workflow-1')
  })

  it('releases the lock and does not retry the tool if the versioned token save rejects', async () => {
    const grant = createGrant()
    grant.save.mockRejectedValueOnce(new Error('Credential grant changed'))
    const request = vi.fn<FetchLike>(async () => rejection())
    await expect(fetchFor(grant, request)(SERVER)).rejects.toThrow('Reauthorization required')
    expect(request).toHaveBeenCalledTimes(1)
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledTimes(1)
  })

  it('forwards the challenged scope when the SDK requires reauthorization', async () => {
    const grant = createGrant()
    grant.tokenRequest.mockResolvedValueOnce(
      Response.json({ error: 'invalid_grant' }, { status: 400 })
    )
    const request = vi.fn<FetchLike>(async () =>
      rejection(403, 'Bearer error="insufficient_scope", scope="read write"')
    )
    await expect(fetchFor(grant, request)(SERVER)).rejects.toThrow('Reauthorization required')
    expect(grant.redirect.mock.calls[0][0].searchParams.get('scope')).toBe('read write')
    expect(grant.save).toHaveBeenCalledWith(undefined)
    expect(request).toHaveBeenCalledTimes(1)
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledTimes(1)
  })

  it('does not authenticate or retry after a grant is disabled before the locked reload', async () => {
    const grant = createGrant()
    grant.loadProvider.mockRejectedValueOnce(new Error('Grant disabled'))
    const request = vi.fn<FetchLike>(async () => rejection())
    await expect(fetchFor(grant, request)(SERVER)).rejects.toThrow('Grant disabled')
    expect(grant.tokenRequest).not.toHaveBeenCalled()
    expect(grant.save).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledTimes(1)
  })

  it('does not attach the MCP bearer token to a different URL', async () => {
    const grant = createGrant()
    const request = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }))
    await fetchFor(grant, request)('https://other.example.com/metadata')
    expect(grant.loadProvider).not.toHaveBeenCalled()
    expect(new Headers(request.mock.calls[0][1]?.headers).has('authorization')).toBe(false)
  })

  it('does not refresh or retry a request cancelled while waiting for the lock', async () => {
    const entered = deferred()
    const finish = deferred()
    const holder = withMcpOauthRefreshLock('shared-grant', async () => {
      entered.resolve()
      await finish.promise
    })
    await entered.promise
    const rejected = deferred()
    const grant = createGrant()
    const request = vi.fn<FetchLike>(async () => {
      rejected.resolve()
      return rejection()
    })
    const abort = new AbortController()
    const call = fetchFor(grant, request)(SERVER, { signal: abort.signal })
    const outcome = expect(call).rejects.toThrow('cancelled')
    await rejected.promise
    abort.abort(new Error('cancelled'))
    finish.resolve()
    await holder
    await outcome
    expect(grant.tokenRequest).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
