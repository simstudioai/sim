/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFlags,
  mockDbLimit,
  mockCheckInternalApiKey,
  mockCheckServerSideUsageLimits,
  mockCheckOrgMemberUsageLimit,
} = vi.hoisted(() => ({
  mockFlags: { isHosted: true },
  mockDbLimit: vi.fn(),
  mockCheckInternalApiKey: vi.fn(),
  mockCheckServerSideUsageLimits: vi.fn(),
  mockCheckOrgMemberUsageLimit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockDbLimit }) }) }),
  },
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: mockCheckServerSideUsageLimits,
  checkOrgMemberUsageLimit: mockCheckOrgMemberUsageLimit,
}))

vi.mock('@/lib/copilot/request/http', () => ({
  checkInternalApiKey: mockCheckInternalApiKey,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withIncomingGoSpan: (
    _headers: unknown,
    _span: unknown,
    _attrs: unknown,
    fn: (span: { setAttribute: () => void; setAttributes: () => void }) => unknown
  ) => fn({ setAttribute: vi.fn(), setAttributes: vi.fn() }),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return mockFlags.isHosted
  },
}))

import { POST } from '@/app/api/copilot/api-keys/validate/route'

function request(body: Record<string, unknown>) {
  return createMockRequest('POST', body, { 'x-api-key': 'internal' })
}

describe('POST /api/copilot/api-keys/validate — per-member enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockDbLimit.mockResolvedValue([{ id: 'user-1' }])
    mockCheckServerSideUsageLimits.mockResolvedValue({
      isExceeded: false,
      currentUsage: 0,
      limit: 100,
    })
    mockCheckOrgMemberUsageLimit.mockResolvedValue({
      isExceeded: false,
      currentUsage: 0,
      limit: null,
    })
  })

  it('returns 402 when the pooled/personal limit is exceeded (existing behavior)', async () => {
    mockCheckServerSideUsageLimits.mockResolvedValue({
      isExceeded: true,
      currentUsage: 200,
      limit: 100,
    })
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(402)
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('returns 402 when the per-member org-workspace cap is exceeded', async () => {
    mockCheckOrgMemberUsageLimit.mockResolvedValue({
      isExceeded: true,
      currentUsage: 5,
      limit: 4,
    })
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(402)
    expect(mockCheckOrgMemberUsageLimit).toHaveBeenCalledWith('user-1', 'ws-1')
  })

  it('returns 200 when under both limits', async () => {
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(200)
  })

  it('rejects with 400 when workspaceId is omitted (contract-required, fail closed)', async () => {
    const res = await POST(request({ userId: 'user-1' }))
    expect(res.status).toBe(400)
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('skips the per-member check when not hosted', async () => {
    mockFlags.isHosted = false
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(200)
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
  })
})
