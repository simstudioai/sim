/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnforceIpRateLimit } = vi.hoisted(() => ({ mockEnforceIpRateLimit: vi.fn() }))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/core/rate-limiter', () => ({ enforceIpRateLimit: mockEnforceIpRateLimit }))

import { POST } from '@/app/api/auth/sso/resolve/route'

describe('POST /api/auth/sso/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnforceIpRateLimit.mockResolvedValue(null)
  })

  it('names the provider that serves the address domain', async () => {
    queueTableRows(schemaMock.ssoProvider, [{ providerId: 'acme-okta' }])
    const res = await POST(createMockRequest('POST', { email: 'Ada@Acme.com' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ providerId: 'acme-okta' })
    const [condition] = dbChainMockFns.where.mock.calls[0]
    expect(JSON.stringify(condition)).toContain('acme.com')
    expect(JSON.stringify(condition)).toContain('domainVerified')
  })

  it('prefers the provider the verified domain names, then provider id', async () => {
    queueTableRows(schemaMock.ssoProvider, [{ providerId: 'acme-okta' }])
    await POST(createMockRequest('POST', { email: 'ada@acme.com' }))
    expect(dbChainMockFns.leftJoin).toHaveBeenCalledWith(schemaMock.ssoDomain, expect.anything())
    const [named, byId] = dbChainMockFns.orderBy.mock.calls[0]
    expect(named).toMatchObject({ type: 'desc' })
    expect(JSON.stringify(named)).toContain('primaryProviderId')
    expect(byId).toEqual({ type: 'asc', column: schemaMock.ssoProvider.providerId })
  })

  it('honors a test link only for a provider that serves the address domain', async () => {
    queueTableRows(schemaMock.ssoProvider, [{ providerId: 'acme-entra' }])
    const res = await POST(
      createMockRequest('POST', { email: 'ada@acme.com', providerId: 'acme-entra' })
    )
    await expect(res.json()).resolves.toMatchObject({ providerId: 'acme-entra' })
    const condition = JSON.stringify(dbChainMockFns.where.mock.calls[0][0])
    expect(condition).toContain('acme-entra')
    expect(condition).toContain('acme.com')
    expect(condition).toContain('domainVerified')
  })

  it('answers 404 for a test link naming a provider that does not serve the domain', async () => {
    queueTableRows(schemaMock.ssoProvider, [])
    const res = await POST(
      createMockRequest('POST', { email: 'ada@acme.com', providerId: 'someone-elses-idp' })
    )
    expect(res.status).toBe(404)
  })

  it('answers 404 when no provider serves the domain', async () => {
    queueTableRows(schemaMock.ssoProvider, [])
    const res = await POST(createMockRequest('POST', { email: 'ada@nowhere.test' }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'SSO_NO_PROVIDER' })
  })

  it('refuses a malformed address before reading anything', async () => {
    const res = await POST(createMockRequest('POST', { email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('is admitted per address', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(new Response(null, { status: 429 }))
    const res = await POST(createMockRequest('POST', { email: 'ada@acme.com' }))
    expect(res.status).toBe(429)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
