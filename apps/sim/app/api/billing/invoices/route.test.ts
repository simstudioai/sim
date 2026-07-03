/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetStripeClient, mockStripeInvoicesList } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetStripeClient: vi.fn(),
  mockStripeInvoicesList: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: mockGetStripeClient,
}))

import { GET } from '@/app/api/billing/invoices/route'

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: `in_${Math.random().toString(36).slice(2)}`,
    number: 'INV-1',
    created: 1700000000,
    total: 1000,
    amount_paid: 1000,
    currency: 'usd',
    status: 'paid',
    hosted_invoice_url: 'https://stripe.test/invoice',
    invoice_pdf: 'https://stripe.test/invoice.pdf',
    ...overrides,
  }
}

describe('GET /api/billing/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    dbChainMockFns.limit.mockResolvedValue([{ customer: 'cus_1' }])
    mockGetStripeClient.mockReturnValue({ invoices: { list: mockStripeInvoicesList } })
  })

  it('does not surface hasMore when the trailing raw invoice beyond MAX_INVOICES is a draft', async () => {
    // 10 finalized invoices exactly at MAX_INVOICES, plus 1 draft, and Stripe has
    // nothing further — the old limit:MAX_INVOICES fetch would have missed the
    // draft entirely and reported has_more from a truncated raw page.
    const finalized = Array.from({ length: 10 }, () => makeInvoice())
    mockStripeInvoicesList.mockResolvedValueOnce({
      data: [...finalized, makeInvoice({ status: 'draft' })],
      has_more: false,
    })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(body.invoices).toHaveLength(10)
    expect(body.hasMore).toBe(false)
  })

  it('reports hasMore when there are genuinely more finalized invoices', async () => {
    const finalized = Array.from({ length: 11 }, () => makeInvoice())
    mockStripeInvoicesList.mockResolvedValueOnce({ data: finalized, has_more: false })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(body.invoices).toHaveLength(10)
    expect(body.hasMore).toBe(true)
  })

  it('pages through further drafts to confirm hasMore when the first page is inconclusive', async () => {
    mockStripeInvoicesList
      .mockResolvedValueOnce({
        data: Array.from({ length: 11 }, () => makeInvoice({ status: 'draft' })),
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [makeInvoice()],
        has_more: false,
      })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(mockStripeInvoicesList).toHaveBeenCalledTimes(2)
    expect(body.invoices).toHaveLength(1)
    expect(body.hasMore).toBe(false)
  })
})
