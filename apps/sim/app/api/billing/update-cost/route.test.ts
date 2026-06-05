/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalApiKey, mockRecordUsage, mockCheckAndBillOverageThreshold } = vi.hoisted(
  () => ({
    mockCheckInternalApiKey: vi.fn(),
    mockRecordUsage: vi.fn(),
    mockCheckAndBillOverageThreshold: vi.fn(),
  })
)

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

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: mockCheckAndBillOverageThreshold,
}))

vi.mock('@/lib/core/idempotency/service', () => ({
  billingIdempotency: {
    atomicallyClaim: vi.fn(),
    release: vi.fn(),
  },
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isBillingEnabled: true,
}))

import { POST } from '@/app/api/billing/update-cost/route'

describe('POST /api/billing/update-cost — workspaceId attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockRecordUsage.mockResolvedValue(undefined)
    mockCheckAndBillOverageThreshold.mockResolvedValue(undefined)
  })

  it('stamps workspaceId onto recorded usage when provided', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { userId: 'user-1', cost: 0.5, model: 'gpt', source: 'mcp_copilot', workspaceId: 'ws-1' },
        { 'x-api-key': 'internal' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workspaceId: 'ws-1',
    })
  })

  it('records with undefined workspaceId when omitted', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { userId: 'user-1', cost: 0.5, model: 'gpt', source: 'copilot' },
        { 'x-api-key': 'internal' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecordUsage.mock.calls[0][0].workspaceId).toBeUndefined()
  })
})
