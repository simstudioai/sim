/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  resetDbChainMock,
  resetEnvMock,
  setEnv,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRecordUsage,
  mockVerifyWorkspaceMembership,
  mockResolveBillingAttribution,
  mockCheckAttributedUsageLimits,
  mockToBillingContext,
  mockCheckAndBillPayerOverageThreshold,
} = vi.hoisted(() => ({
  mockRecordUsage: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockToBillingContext: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mockRecordUsage }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: mockVerifyWorkspaceMembership,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = vi.fn().mockResolvedValue({ allowed: true })
  },
}))

import { POST } from '@/app/api/speech/token/route'

const mockGetSession = authMockFns.mockGetSession

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnv({ ELEVENLABS_API_KEY: 'test-key' })
  mockGetSession.mockResolvedValue({ user: { id: 'member-1' } })
  mockRecordUsage.mockResolvedValue(undefined)
  mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
  mockResolveBillingAttribution.mockImplementation(
    ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) => ({
      actorUserId,
      workspaceId,
      billingEntity: { type: 'organization', id: 'org-1' },
    })
  )
  mockToBillingContext.mockImplementation(
    (attribution: { billingEntity: { type: 'organization' | 'user'; id: string } }) => ({
      billingEntity: attribution.billingEntity,
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
  )
  mockVerifyWorkspaceMembership.mockResolvedValue('admin')
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'tok-123' }),
    // double-cast-allowed: minimal fetch stub for the ElevenLabs token call
  }) as unknown as typeof fetch
})

afterAll(() => {
  resetDbChainMock()
  resetEnvMock()
})

describe('POST /api/speech/token — usage attribution', () => {
  it('editor voice: bills the session user and stamps the verified workspace', async () => {
    const res = await POST(createMockRequest('POST', { workspaceId: 'ws-1' }))

    expect(res.status).toBe(200)
    expect(mockVerifyWorkspaceMembership).toHaveBeenCalledWith('member-1', 'ws-1')
    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'member-1',
      workspaceId: 'ws-1',
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'member-1',
      workspaceId: 'ws-1',
    })
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith({
      type: 'organization',
      id: 'org-1',
    })
  })

  it('editor voice: rejects an unverified workspace id (requires an attributable workspace)', async () => {
    mockVerifyWorkspaceMembership.mockResolvedValue(null)

    const res = await POST(createMockRequest('POST', { workspaceId: 'ws-not-mine' }))

    expect(res.status).toBe(400)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('rejects an oversized body before any auth/billing work runs', async () => {
    const oversizedBody = { workspaceId: 'x'.repeat(64 * 1024) }
    const res = await POST(createMockRequest('POST', oversizedBody))

    expect(res.status).toBe(413)
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })
})
