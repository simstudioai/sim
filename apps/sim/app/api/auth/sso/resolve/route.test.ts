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

  it('is admitted per address', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(new Response(null, { status: 429 }))
    const res = await POST(createMockRequest('POST', { email: 'ada@acme.com' }))
    expect(res.status).toBe(429)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
