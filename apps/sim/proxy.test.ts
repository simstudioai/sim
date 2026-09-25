import { createEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    NEXT_PUBLIC_APP_URL: 'https://app.sim.test',
    SIM_MCP_URL: 'https://mcp.sim.test/mcp',
  })
)

import { proxy, resolveApiCorsPolicy } from '@/proxy'

const EXPOSED_HEADERS =
  'Retry-After, WWW-Authenticate, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id, X-Run-Id'

function makeRequest(pathname: string, origin?: string): NextRequest {
  return {
    nextUrl: { pathname },
    headers: {
      get: (name: string) => (name.toLowerCase() === 'origin' ? (origin ?? null) : null),
    },
  } as unknown as NextRequest
}

describe('resolveApiCorsPolicy', () => {
  it('serves OAuth2 routes with wildcard origin and no credentials', () => {
    expect(resolveApiCorsPolicy(makeRequest('/api/auth/oauth2/token'))).toEqual({
      origin: '*',
      credentials: false,
      methods: 'GET, POST, OPTIONS',
      headers: 'Content-Type, Authorization, Accept',
      exposeHeaders: EXPOSED_HEADERS,
    })
  })

  it('serves OAuth discovery documents read-only with wildcard origin', () => {
    expect(
      resolveApiCorsPolicy(makeRequest('/api/auth/.well-known/oauth-authorization-server'))
    ).toEqual({
      origin: '*',
      credentials: false,
      methods: 'GET, OPTIONS',
      headers: 'Content-Type, Accept',
      exposeHeaders: EXPOSED_HEADERS,
    })
  })

  it('reflects origin for chat embeds with credentials enabled', () => {
    const paths = ['/api/chat/abc', '/api/chat/abc/otp', '/api/chat/abc/sso']
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path, 'https://customer.example'))
      expect(policy).toEqual({
        origin: 'https://customer.example',
        credentials: true,
        methods: 'GET, POST, PUT, OPTIONS',
        headers: 'Content-Type, X-Requested-With',
        exposeHeaders: EXPOSED_HEADERS,
      })
    }
  })

  it('drops credentials on embed policy when Origin header is absent (CORS spec invariant)', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/chat/abc'))
    expect(policy.origin).toBe('*')
    expect(policy.credentials).toBe(false)
  })

  it('serves workflow execute with wildcard origin and execution identity header', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/workflows/workflow-123/execute', 'https://other.example')
    )
    expect(policy.origin).toBe('*')
    expect(policy.credentials).toBe(false)
    expect(policy.methods).toContain('PUT')
    expect(policy.headers).toContain('X-Execution-Id')
    expect(policy.headers).toContain('X-Execution-Timeout-Seconds')
  })

  it('does not match the v2 execute rule for nested or runs paths', () => {
    const nested = resolveApiCorsPolicy(
      makeRequest('/api/v2/workflows/workflow-123/execute/extra', 'https://other.example')
    )
    expect(nested.origin).toBe('https://app.sim.test')
    const runs = resolveApiCorsPolicy(
      makeRequest('/api/v2/workflows/workflow-123/runs/run-1', 'https://other.example')
    )
    expect(runs.origin).toBe('https://app.sim.test')
  })

  it('returns default policy with APP_URL and credentials for other API routes', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/files/uploads'))
    expect(policy).toEqual({
      origin: 'https://app.sim.test',
      credentials: true,
      methods: 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
      exposeHeaders: EXPOSED_HEADERS,
      headers: expect.stringContaining('Authorization'),
    })
  })

  it('exposes the response headers on every matched rule, so a new rule cannot drop them', () => {
    const paths = [
      '/api/auth/oauth2/token',
      '/api/mcp/copilot',
      '/api/chat/abc',
      '/api/workflows/wf/execute',
      '/api/v2/workflows/wf/execute',
      '/api/files/uploads',
    ]
    for (const path of paths) {
      expect(resolveApiCorsPolicy(makeRequest(path)).exposeHeaders).toBe(EXPOSED_HEADERS)
    }
  })

  it('never pairs wildcard origin with credentials (CORS spec invariant)', () => {
    const paths = [
      '/api/auth/oauth2/token',
      '/api/mcp/copilot',
      '/api/chat/abc',
      '/api/workflows/wf/execute',
      '/api/v2/workflows/wf/execute',
      '/api/files/uploads',
    ]
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path))
      if (policy.origin === '*') {
        expect(policy.credentials).toBe(false)
      }
    }
  })
})

describe('proxy on the dedicated MCP host', () => {
  function mcpRequest(pathname: string, method = 'POST') {
    return new NextRequest(`https://mcp.sim.test${pathname}`, {
      method,
      headers: { host: 'mcp.sim.test', origin: 'https://app.sim.test' },
    })
  }

  it('answers the endpoint preflight with the API CORS policy', () => {
    const response = proxy(mcpRequest('/mcp', 'OPTIONS'))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.sim.test')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('serves nothing else on the MCP host', () => {
    expect(proxy(mcpRequest('/login', 'GET')).status).toBe(404)
  })
})
