/**
 * Tests for the billing seat reconciliation cron route.
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockReconcileTeamSeatDrift, mockFindDeadLetteredEvents } = vi.hoisted(
  () => ({
    mockVerifyCronAuth: vi.fn().mockReturnValue(null),
    mockReconcileTeamSeatDrift: vi.fn(),
    mockFindDeadLetteredEvents: vi.fn(),
  })
)

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/billing/organizations/seat-drift', () => ({
  reconcileTeamSeatDrift: mockReconcileTeamSeatDrift,
}))
vi.mock('@/lib/core/outbox/service', () => ({ findDeadLetteredEvents: mockFindDeadLetteredEvents }))
vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
    STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
  },
}))

import { GET } from './route'

function createRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/reconcile-billing-seats'
  )
}

describe('reconcile-billing-seats cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyCronAuth.mockReturnValue(null)
    mockReconcileTeamSeatDrift.mockResolvedValue({ drifted: 0, reconciled: 0 })
    mockFindDeadLetteredEvents.mockResolvedValue([])
  })

  it('returns the auth error when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValueOnce(new Response(null, { status: 401 }) as never)

    const response = await GET(createRequest())

    expect(response.status).toBe(401)
    expect(mockReconcileTeamSeatDrift).not.toHaveBeenCalled()
  })

  it('runs the drift sweep and reports dead-lettered billing syncs', async () => {
    mockReconcileTeamSeatDrift.mockResolvedValue({ drifted: 2, reconciled: 1 })
    mockFindDeadLetteredEvents.mockResolvedValue([
      {
        id: 'evt-1',
        eventType: 'stripe.sync-subscription-seats',
        payload: { subscriptionId: 'sub-1' },
        lastError: 'card declined',
      },
    ])

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      success: true,
      drift: { drifted: 2, reconciled: 1 },
      deadLetteredBillingSyncs: 1,
    })
    expect(mockFindDeadLetteredEvents).toHaveBeenCalledWith([
      'stripe.sync-subscription-seats',
      'stripe.sync-cancel-at-period-end',
    ])
  })

  it('returns 500 when the sweep throws', async () => {
    mockReconcileTeamSeatDrift.mockRejectedValueOnce(new Error('boom'))

    const response = await GET(createRequest())

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.success).toBe(false)
  })
})
