/**
 * @vitest-environment node
 */
import { createEnvMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({ NEXT_PUBLIC_APP_URL: 'https://app.sim.test' })
)

import { resolveApiCorsPolicy } from '@/proxy'

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

  /**
   * `proxy()` consults this table only for `/api/` paths, so a rule matching
   * the origin-root discovery document would never run. That copy sets its own
   * `Access-Control-Allow-Origin` in the route handler instead; a rule here
   * would read as coverage it does not have.
   */
  it('leaves the origin-root discovery document to its own route handler', () => {
    const rootPolicy = resolveApiCorsPolicy(makeRequest('/.well-known/oauth-authorization-server'))
    const apiPolicy = resolveApiCorsPolicy(
      makeRequest('/api/auth/.well-known/oauth-authorization-server')
    )
    expect(rootPolicy).not.toEqual(apiPolicy)
  })

  it('serves MCP copilot with DELETE in allowed methods', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/mcp/copilot'))
    expect(policy.origin).toBe('*')
    expect(policy.methods).toContain('DELETE')
    expect(policy.headers).toContain('X-API-Key')
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

  it('allows PUT on the embed policy (used by OTP verification on /[identifier]/otp)', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/chat/abc/otp', 'https://customer.example')
    )
    expect(policy.methods).toContain('PUT')
  })

  it('applies the embed policy to future identifier subroutes (not just /otp, /sso)', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/chat/abc/transcript', 'https://customer.example')
    )
    expect(policy.origin).toBe('https://customer.example')
    expect(policy.credentials).toBe(true)
  })

  it('uses the default credentialed policy for workspace-internal chat routes', () => {
    const paths = ['/api/chat', '/api/chat/manage/abc', '/api/chat/validate']
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path, 'https://customer.example'))
      expect(policy.origin).toBe('https://app.sim.test')
      expect(policy.credentials).toBe(true)
    }
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

  it('serves v2 workflow execute with wildcard origin and the stream-protocol header', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/v2/workflows/workflow-123/execute', 'https://other.example')
    )
    expect(policy.origin).toBe('*')
    expect(policy.credentials).toBe(false)
    expect(policy.headers).toContain('X-Run-Id')
    expect(policy.headers).toContain('X-Sim-Stream-Protocol')
    expect(policy.headers).toContain('Authorization')
    expect(policy.headers).not.toContain('X-Execution-Id')
    // Async is body-selected on v2 — the mode header is deliberately absent.
    expect(policy.headers).not.toContain('X-Execution-Mode')
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

  it('does not match the workflow execute rule for nested paths', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/workflows/workflow-123/execute/extra', 'https://other.example')
    )
    expect(policy.origin).toBe('https://app.sim.test')
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

  /**
   * `X-Run-Id` is emitted by the v2 execute route alone, and that route is
   * wildcard-origin so browsers can call it — a policy that omits the exposed
   * headers leaves the run id, and a 429's `Retry-After`, unreadable to exactly
   * the callers the route exists for.
   */
  it('exposes the response headers on the v2 execute policy, not just the default one', () => {
    const execute = resolveApiCorsPolicy(
      makeRequest('/api/v2/workflows/workflow-123/execute', 'https://other.example')
    )
    expect(execute.exposeHeaders).toBe(EXPOSED_HEADERS)
    expect(execute.exposeHeaders).toContain('X-Run-Id')
    expect(execute.exposeHeaders).toContain('Retry-After')

    const fallback = resolveApiCorsPolicy(makeRequest('/api/files/uploads'))
    expect(fallback.exposeHeaders).toBe(execute.exposeHeaders)
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
