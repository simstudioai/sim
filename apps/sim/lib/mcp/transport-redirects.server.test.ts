/**
 * Redirects across the MCP SDK and our SSRF guard, over real loopback sockets.
 * Nothing between the SDK and the wire is mocked: two local servers on different
 * ports are two origins, and loopback is reachable under the self-hosted profile.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { exchangeAuthorization } from '@modelcontextprotocol/sdk/client/auth.js'
import { ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpClient } from '@/lib/mcp/client'
import { createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

interface RecordedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

interface LocalServer {
  origin: string
  requests: RecordedRequest[]
  openSockets: Set<Socket>
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
  const openSockets = new Set<Socket>()
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
  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const local: LocalServer = {
    origin: `http://127.0.0.1:${port}`,
    requests,
    openSockets,
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

describe('guarded MCP OAuth fetch', () => {
  it('hands an unfollowed cross-origin token redirect back to the SDK, naming its target, and releases the socket', async () => {
    const elsewhere = await startServer((_request, _body, respond) => respond(200, {}, '{}'))
    const authServer = await startServer((_request, _body, respond) => {
      respond(302, { location: `${elsewhere.origin}/token` }, 'moved')
    })

    const exchange = exchangeAuthorization(authServer.origin, {
      metadata: {
        issuer: authServer.origin,
        authorization_endpoint: `${authServer.origin}/authorize`,
        token_endpoint: `${authServer.origin}/token`,
        response_types_supported: ['code'],
      },
      clientInformation: { client_id: 'client-1' },
      authorizationCode: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://127.0.0.1/callback',
      fetchFn: createSsrfGuardedMcpFetch({
        serverUrl: `${authServer.origin}/mcp`,
        timeoutMs: 5_000,
      }),
    })

    const error = await exchange.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ServerError)
    expect((error as Error).message).toBe(
      `HTTP 302: Redirect to ${elsewhere.origin}/token not followed`
    )
    expect(authServer.requests.map((request) => request.method)).toEqual(['POST'])
    expect(elsewhere.requests).toHaveLength(0)
    await vi.waitFor(() => expect(authServer.openSockets.size).toBe(0), { timeout: 2_000 })
  })
})
