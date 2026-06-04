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
    })
  })

  it('serves MCP copilot with DELETE in allowed methods', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/mcp/copilot'))
    expect(policy.origin).toBe('*')
    expect(policy.methods).toContain('DELETE')
    expect(policy.headers).toContain('X-API-Key')
  })

  it('reflects origin for chat and form embeds with credentials enabled', () => {
    const paths = [
      '/api/chat/abc',
      '/api/chat/abc/otp',
      '/api/chat/abc/sso',
      '/api/form/xyz',
      '/api/form/xyz/otp',
    ]
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path, 'https://customer.example'))
      expect(policy).toEqual({
        origin: 'https://customer.example',
        credentials: true,
        methods: 'GET, POST, PUT, OPTIONS',
        headers: 'Content-Type, X-Requested-With',
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

  it('uses the default credentialed policy for workspace-internal chat/form routes', () => {
    const paths = [
      '/api/chat',
      '/api/chat/manage/abc',
      '/api/chat/validate',
      '/api/form',
      '/api/form/manage/abc',
      '/api/form/validate',
    ]
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path, 'https://customer.example'))
      expect(policy.origin).toBe('https://app.sim.test')
      expect(policy.credentials).toBe(true)
    }
  })

  it('serves workflow execute with wildcard origin and PUT method', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/workflows/workflow-123/execute', 'https://other.example')
    )
    expect(policy.origin).toBe('*')
    expect(policy.credentials).toBe(false)
    expect(policy.methods).toContain('PUT')
  })

  it('does not match the workflow execute rule for nested paths', () => {
    const policy = resolveApiCorsPolicy(
      makeRequest('/api/workflows/workflow-123/execute/extra', 'https://other.example')
    )
    expect(policy.origin).toBe('https://app.sim.test')
  })

  it('returns default policy with APP_URL and credentials for other API routes', () => {
    const policy = resolveApiCorsPolicy(makeRequest('/api/files/upload'))
    expect(policy).toEqual({
      origin: 'https://app.sim.test',
      credentials: true,
      methods: 'GET,POST,OPTIONS,PUT,DELETE',
      headers: expect.stringContaining('Authorization'),
    })
  })

  it('never pairs wildcard origin with credentials (CORS spec invariant)', () => {
    const paths = [
      '/api/auth/oauth2/token',
      '/api/mcp/copilot',
      '/api/chat/abc',
      '/api/form',
      '/api/workflows/wf/execute',
      '/api/files/upload',
    ]
    for (const path of paths) {
      const policy = resolveApiCorsPolicy(makeRequest(path))
      if (policy.origin === '*') {
        expect(policy.credentials).toBe(false)
      }
    }
  })
})
