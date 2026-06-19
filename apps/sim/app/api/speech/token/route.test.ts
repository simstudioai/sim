/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockRecordUsage,
  mockCheckActorUsageLimits,
  mockGetWorkspaceBilledAccountUserId,
  mockVerifyWorkspaceMembership,
  mockChatRows,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockChatRows: { value: [] as Array<Record<string, unknown>> },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.leftJoin = () => chain
      chain.where = () => chain
      chain.limit = () => Promise.resolve(mockChatRows.value)
      return chain
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mockRecordUsage }))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
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
  mockChatRows.value = []
  mockGetSession.mockResolvedValue({ user: { id: 'member-1' } })
  mockRecordUsage.mockResolvedValue(undefined)
  mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
  mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billed-acct')
  mockVerifyWorkspaceMembership.mockResolvedValue('admin')
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'tok-123' }),
    // double-cast-allowed: minimal fetch stub for the ElevenLabs token call
  }) as unknown as typeof fetch
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
  })

  it('editor voice: rejects an unverified workspace id (requires an attributable workspace)', async () => {
    mockVerifyWorkspaceMembership.mockResolvedValue(null)

    const res = await POST(createMockRequest('POST', { workspaceId: 'ws-not-mine' }))

    expect(res.status).toBe(400)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('deployed chat: bills the workspace billed account and stamps the chat workspace', async () => {
    mockChatRows.value = [publicChatRow]

    const res = await POST(createMockRequest('POST', { chatId: 'chat-1' }))

    expect(res.status).toBe(200)
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockGetWorkspaceBilledAccountUserId).toHaveBeenCalledWith('ws-1')
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'billed-acct',
      workspaceId: 'ws-1',
    })
  })

  it('deployed chat: falls back to the chat owner when no billed account resolves', async () => {
    mockChatRows.value = [publicChatRow]
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue(null)

    const res = await POST(createMockRequest('POST', { chatId: 'chat-1' }))

    expect(res.status).toBe(200)
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'owner-1',
      workspaceId: 'ws-1',
    })
  })
})
