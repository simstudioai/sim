import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { createSimMcpHandlers } from '@/lib/api/mcp/route-handler'
import { getBaseUrl } from '@/lib/core/utils/urls'

const BASE = getBaseUrl()

const handlers = createSimMcpHandlers()
const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
  keyExpiresAt: null,
}
const audience = { resource: `${BASE}/api/mcp`, allowUnboundApiTokens: true }

function rpc(
  message: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer sk-sim-personal' }
) {
  return new NextRequest(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...message }),
  })
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  headers?: Record<string, string>
) {
  const response = await handlers.POST(
    rpc({ method: 'tools/call', params: { name, arguments: args } }, headers),
    undefined
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  return body.result as { isError?: boolean; content: Array<{ type: string; text: string }> }
}

beforeEach(() => {
  v2RouteMocks.authenticate.mockResolvedValue(auth)
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
})

describe('Sim MCP admission', () => {
  it.each(['GET', 'POST', 'DELETE'] as const)(
    'points an unauthenticated %s at the protected-resource metadata',
    async (method) => {
      v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError())
      const response = await handlers[method](rpc({ method: 'tools/list' }, {}), undefined)
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBe(
        `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp", scope="api:read api:write"`
      )
    }
  )

  it('refuses browser requests from other origins', async () => {
    const response = await handlers.POST(
      rpc(
        { method: 'tools/list' },
        { authorization: 'Bearer sk-sim-personal', origin: 'https://attacker.example' }
      ),
      undefined
    )
    expect(response.status).toBe(403)
  })
})

describe('Sim MCP tools', () => {
  it('serves a read through the v2 route with the MCP credential and audience', async () => {
    const result = await callTool('call_read_operation', { operation: 'getMeta' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text)).toEqual({
      data: { v2Enabled: true, keyType: 'personal', expiresAt: null },
    })
    expect(v2RouteMocks.authenticate).toHaveBeenCalledTimes(2)
    expect(v2RouteMocks.authenticate).toHaveBeenLastCalledWith(
      { apiKey: 'sk-sim-personal', bearer: null, malformedOAuthBearer: false },
      audience
    )
  })

  it('returns the v2 error envelope as a tool error', async () => {
    v2RouteMocks.authenticate
      .mockResolvedValueOnce(auth)
      .mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError('Invalid API key'))
    const result = await callTool('call_read_operation', { operation: 'getMeta' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
    })
  })

  it('asks an OAuth token without api:write to step up before the write tool runs', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
      ...auth,
      principal: {
        kind: 'oauth_access_token' as const,
        userId: 'user-1',
        clientId: 'client-1',
        tokenId: 'token-1',
        scopes: ['api:read'],
        expiresAt: new Date(Date.now() + 60_000),
      },
      keyType: 'oauth_access_token' as const,
    })
    const response = await handlers.POST(
      rpc(
        {
          method: 'tools/call',
          params: { name: 'call_write_operation', arguments: { operation: 'createTable' } },
        },
        { authorization: 'Bearer sim_oat_read_only' }
      ),
      undefined
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer error="insufficient_scope", resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp", scope="api:write"`
    )
    expect(v2RouteMocks.authenticate).toHaveBeenCalledTimes(1)
  })

  it('checks the scope the dispatched operation declares, not its HTTP method', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
      ...auth,
      principal: {
        kind: 'oauth_access_token' as const,
        userId: 'user-1',
        clientId: 'client-1',
        tokenId: 'token-1',
        scopes: ['api:read'],
        expiresAt: new Date(Date.now() + 60_000),
      },
      keyType: 'oauth_access_token' as const,
    })
    const response = await handlers.POST(
      rpc(
        {
          method: 'tools/call',
          params: {
            name: 'call_write_operation',
            arguments: { operation: 'queryRows', params: { tableId: 'tbl_1' } },
          },
        },
        { authorization: 'Bearer sim_oat_read_only' }
      ),
      undefined
    )
    expect(response.status).toBe(200)
  })

  it('refuses a write operation on the read tool', async () => {
    const result = await callTool('call_read_operation', { operation: 'createTable' })
    expect(result.isError).toBe(true)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledTimes(1)
  })
})
