/**
 * Redirects across the MCP SDK and our SSRF guard, over real loopback sockets.
 * Nothing between the SDK and the wire is mocked: two local servers on different
 * ports are two origins, and loopback is reachable under the self-hosted profile.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpClient } from '@/lib/mcp/client'
import { mcpAuthGuarded } from '@/lib/mcp/oauth/auth'
import { createGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

interface RecordedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

interface LocalServer {
  origin: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

type Handler = (
  request: RecordedRequest,
  body: string,
  respond: (status: number, headers: Record<string, string>, body?: string) => void
) => void

const servers: LocalServer[] = []

async function startServer(handler: Handler): Promise<LocalServer> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers }
      requests.push(recorded)
      handler(recorded, Buffer.concat(chunks).toString('utf8'), (status, headers, body) => {
        res.writeHead(status, headers)
        if (body === undefined) res.flushHeaders()
        else res.end(body)
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const local: LocalServer = {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
  servers.push(local)
  return local
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('MCP transport redirects', () => {
  it('follows a cross-origin redirect of the SSE stream through the guard, without the configured credentials', async () => {
    const www = await startServer((_request, _body, respond) => {
      respond(200, { 'content-type': 'text/event-stream' })
    })
    const apex = await startServer((request, body, respond) => {
      if (request.method === 'GET') {
        respond(302, { location: `${www.origin}/mcp` }, '')
        return
      }
      if (request.method === 'DELETE') {
        respond(200, {}, '')
        return
      }
      const message = JSON.parse(body) as { id?: number; method: string }
      if (message.method !== 'initialize') {
        respond(202, {}, '')
        return
      }
      respond(
        200,
        { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: 'apex', version: '1.0.0' },
          },
        })
      )
    })

    const client = new McpClient({
      config: {
        id: 'server-1',
        name: 'Apex',
        transport: 'streamable-http',
        url: `${apex.origin}/mcp`,
        headers: { Authorization: 'Bearer configured-secret', 'X-Api-Key': 'configured-key' },
      },
    })
    try {
      await client.connect()
      await vi.waitFor(() => expect(www.requests).toHaveLength(1), { timeout: 5_000 })
    } finally {
      await client.disconnect()
    }

    const apexStream = apex.requests.find((request) => request.method === 'GET')
    expect(apexStream?.headers.authorization).toBe('Bearer configured-secret')
    const [redirected] = www.requests
    expect(redirected.method).toBe('GET')
    expect(redirected.url).toBe('/mcp')
    expect(redirected.headers.authorization).toBeUndefined()
    expect(redirected.headers['x-api-key']).toBeUndefined()
    expect(redirected.headers['mcp-session-id']).toBeUndefined()
  })
})

const OAUTH_FETCHES = [
  { name: 'the default OAuth fetch', fetchFn: () => undefined },
  {
    name: 'the transport fetch reused by coordinated refresh',
    fetchFn: (serverUrl: string) => createGuardedMcpFetch(serverUrl).fetch,
  },
] as const

function recordingProvider() {
  const authorizationUrls: URL[] = []
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return 'http://127.0.0.1/callback'
    },
    get clientMetadata() {
      return { redirect_uris: ['http://127.0.0.1/callback'] }
    },
    clientInformation: () => ({ client_id: 'client-1' }),
    tokens: () => undefined,
    saveTokens: () => {},
    redirectToAuthorization: (url) => {
      authorizationUrls.push(url)
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => 'verifier-1',
  }
  return { provider, authorizationUrls }
}

function authorizationServerMetadata(origin: string) {
  return JSON.stringify({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  })
}

describe('MCP OAuth redirects', () => {
  it.each(OAUTH_FETCHES)(
    'follows a cross-origin redirect of protected-resource discovery through $name, without its headers',
    async ({ fetchFn }) => {
      const json = { 'content-type': 'application/json' }
      let apexOrigin = ''
      const www = await startServer((_request, _body, respond) => {
        respond(
          200,
          json,
          JSON.stringify({ resource: `${apexOrigin}/mcp`, authorization_servers: [apexOrigin] })
        )
      })
      const apex = await startServer((request, _body, respond) => {
        if (request.url === '/.well-known/oauth-protected-resource/mcp') {
          respond(302, { location: `${www.origin}${request.url}` }, '')
        } else if (request.url === '/.well-known/oauth-authorization-server') {
          respond(200, json, authorizationServerMetadata(apexOrigin))
        } else {
          respond(404, {}, '')
        }
      })
      apexOrigin = apex.origin
      const serverUrl = `${apex.origin}/mcp`
      const { provider, authorizationUrls } = recordingProvider()

      await expect(
        mcpAuthGuarded(provider, { serverUrl, fetchFn: fetchFn(serverUrl) })
      ).resolves.toBe('REDIRECT')

      expect(apex.requests[0].headers['mcp-protocol-version']).toBeDefined()
      expect(www.requests).toHaveLength(1)
      expect(www.requests[0].headers['mcp-protocol-version']).toBeUndefined()
      expect(www.requests[0].headers.authorization).toBeUndefined()
      expect(authorizationUrls).toHaveLength(1)
      expect(authorizationUrls[0].searchParams.get('resource')).toBe(serverUrl)
    }
  )

  it.each(OAUTH_FETCHES)(
    'refuses a cross-origin 307 of the token request through $name, as it would forward the body',
    async ({ fetchFn }) => {
      const elsewhere = await startServer((_request, _body, respond) => respond(200, {}, '{}'))
      const apex = await startServer((request, _body, respond) => {
        if (request.url === '/.well-known/oauth-authorization-server') {
          respond(
            200,
            { 'content-type': 'application/json' },
            authorizationServerMetadata(apex.origin)
          )
        } else if (request.url === '/token') {
          respond(307, { location: `${elsewhere.origin}/token` }, '')
        } else {
          respond(404, {}, '')
        }
      })
      const serverUrl = `${apex.origin}/mcp`
      const { provider } = recordingProvider()

      await expect(
        mcpAuthGuarded(provider, {
          serverUrl,
          authorizationCode: 'code-1',
          fetchFn: fetchFn(serverUrl),
        })
      ).rejects.toThrow(
        'Blocked by SSRF policy: cross-origin redirect would forward a request body'
      )

      expect(apex.requests.filter((request) => request.url === '/token')).toHaveLength(1)
      expect(elsewhere.requests).toHaveLength(0)
    }
  )
})
