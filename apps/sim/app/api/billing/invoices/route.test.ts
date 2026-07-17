/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns } from '@sim/testing'
import { generateShortId } from '@sim/utils/id'
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
    id: `in_${generateShortId()}`,
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
    const finalized = Array.from({ length: 5 }, () => makeInvoice())
    mockStripeInvoicesList.mockResolvedValueOnce({
      data: [...finalized, makeInvoice({ status: 'draft' })],
      has_more: false,
    })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(body.invoices).toHaveLength(5)
    expect(body.hasMore).toBe(false)
  })

  it('reports hasMore when there are genuinely more finalized invoices', async () => {
    const finalized = Array.from({ length: 6 }, () => makeInvoice())
    mockStripeInvoicesList.mockResolvedValueOnce({ data: finalized, has_more: false })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(body.invoices).toHaveLength(5)
    expect(body.hasMore).toBe(true)
  })

  it('surfaces the line-item description, preferring the top-level invoice description', async () => {
    mockStripeInvoicesList.mockResolvedValueOnce({
      data: [
        makeInvoice({ lines: { data: [{ description: 'Sim Max' }] } }),
        makeInvoice({
          description: 'Usage overage',
          lines: { data: [{ description: 'ignored line' }] },
        }),
        makeInvoice(),
      ],
      has_more: false,
    })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(body.invoices[0].description).toBe('Sim Max')
    expect(body.invoices[1].description).toBe('Usage overage')
    expect(body.invoices[2].description).toBeNull()
  })

  it('pages through further drafts to confirm hasMore when the first page is inconclusive', async () => {
    const firstPage = Array.from({ length: 11 }, () => makeInvoice({ status: 'draft' }))
    mockStripeInvoicesList
      .mockResolvedValueOnce({ data: firstPage, has_more: true })
      .mockResolvedValueOnce({ data: [makeInvoice()], has_more: false })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(mockStripeInvoicesList).toHaveBeenCalledTimes(2)
    expect(mockStripeInvoicesList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ starting_after: firstPage.at(-1)?.id })
    )
    expect(body.invoices).toHaveLength(1)
    expect(body.hasMore).toBe(false)
  })

  it('reports hasMore when the MAX_STRIPE_PAGES safety cap is hit while Stripe still has more', async () => {
    mockStripeInvoicesList.mockResolvedValue({
      data: Array.from({ length: 11 }, () => makeInvoice({ status: 'draft' })),
      has_more: true,
    })

    const request = createMockRequest('GET')
    const response = await GET(request)
    const body = await response.json()

    expect(mockStripeInvoicesList).toHaveBeenCalledTimes(5)
    expect(body.invoices).toHaveLength(0)
    expect(body.hasMore).toBe(true)
  })
})
