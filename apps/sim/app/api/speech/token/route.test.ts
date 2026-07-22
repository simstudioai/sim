/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockRecordUsage,
  mockCheckActorUsageLimits,
  mockVerifyWorkspaceMembership,
  mockResolveBillingAttribution,
  mockResolveSystemBillingAttribution,
  mockCheckAttributedUsageLimits,
  mockToBillingContext,
  mockCheckAndBillPayerOverageThreshold,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockToBillingContext: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
}))

const SYSTEM_BILLING_ATTRIBUTION = {
  actorUserId: 'owner-after-transfer',
  workspaceId: 'ws-1',
  organizationId: 'org-after-transfer',
  billedAccountUserId: 'owner-after-transfer',
  billingEntity: { type: 'organization' as const, id: 'org-after-transfer' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mockRecordUsage }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: mockVerifyWorkspaceMembership,
}))

vi.mock('@/lib/core/config/env', () => ({ env: { ELEVENLABS_API_KEY: 'test-key' } }))

vi.mock('@/lib/core/config/env-flags', () => ({
  isBillingEnabled: false,
  getCostMultiplier: () => 1,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = vi.fn().mockResolvedValue({ allowed: true })
  },
}))

vi.mock('@/lib/core/security/deployment', () => ({ validateAuthToken: vi.fn(() => false) }))

import { POST } from '@/app/api/speech/token/route'

const publicChatRow = {
  id: 'chat-1',
  userId: 'owner-1',
  isActive: true,
  authType: 'public',
  password: null,
  workspaceId: 'ws-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockGetSession.mockResolvedValue({ user: { id: 'member-1' } })
  mockRecordUsage.mockResolvedValue(undefined)
  mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
  mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
  mockResolveBillingAttribution.mockImplementation(
    ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) => ({
      actorUserId,
      workspaceId,
      billingEntity: { type: 'organization', id: 'org-1' },
    })
  )
  mockResolveSystemBillingAttribution.mockResolvedValue(SYSTEM_BILLING_ATTRIBUTION)
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
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
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

  it('deployed chat: uses one atomic system actor and payer snapshot', async () => {
    queueTableRows(schemaMock.chat, [publicChatRow])

    const res = await POST(createMockRequest('POST', { chatId: 'chat-1' }))

    expect(res.status).toBe(200)
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('ws-1')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(SYSTEM_BILLING_ATTRIBUTION)
    expect(mockToBillingContext).toHaveBeenCalledWith(SYSTEM_BILLING_ATTRIBUTION)
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'owner-after-transfer',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'org-after-transfer' },
    })
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith({
      type: 'organization',
      id: 'org-after-transfer',
    })
  })

  it('deployed chat: uses the chat owner only when no workspace exists', async () => {
    queueTableRows(schemaMock.chat, [{ ...publicChatRow, workspaceId: null }])

    const res = await POST(createMockRequest('POST', { chatId: 'chat-1' }))

    expect(res.status).toBe(200)
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'owner-1',
    })
    expect(mockRecordUsage.mock.calls[0][0].workspaceId).toBeUndefined()
  })

  it('rejects an oversized body before any auth/billing work runs', async () => {
    const oversizedBody = { chatId: 'x'.repeat(64 * 1024) }
    const res = await POST(createMockRequest('POST', oversizedBody))

    expect(res.status).toBe(413)
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })
})
