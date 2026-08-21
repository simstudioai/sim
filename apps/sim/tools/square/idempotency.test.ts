/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() },
  runWithRequestContext: <T>(_context: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
  setRequestTraceId: vi.fn(),
}))

import { deriveDeliveryKey } from '@/lib/core/http/derive-key'
import { squareCreateCatalogImageTool } from '@/tools/square/create_catalog_image'
import { squareCreateCustomerTool } from '@/tools/square/create_customer'
import { squareCreateInvoiceTool } from '@/tools/square/create_invoice'
import { squareCreateOrderTool } from '@/tools/square/create_order'
import { squareCreatePaymentTool } from '@/tools/square/create_payment'
import { squarePayOrderTool } from '@/tools/square/pay_order'
import { squarePublishInvoiceTool } from '@/tools/square/publish_invoice'
import { squareRefundPaymentTool } from '@/tools/square/refund_payment'
import { squareUpsertCatalogObjectTool } from '@/tools/square/upsert_catalog_object'
import type { ToolConfig } from '@/tools/types'

/** A complete execution identity, as the executor is expected to inject it. */
const CONTEXT = {
  executionId: 'exec-1',
  blockId: 'block-1',
  invocationId: '7',
} as const

/**
 * Square's tightest documented ceiling on `idempotency_key`, from `/v2/payments`
 * and `/v2/customers`.
 */
const SQUARE_KEY_MAX_LENGTH = 45

/**
 * Calls a tool's body builder the way tool preparation does.
 *
 * Reading `request.body` is confined to the canonical transport in production
 * source; `check-tool-request-boundary.ts` exempts test files precisely so a
 * request shape can be asserted without a live transport.
 */
function buildBody(tool: ToolConfig, params: Record<string, unknown>): Record<string, unknown> {
  const body = tool.request.body?.(params)
  if (typeof body !== 'object' || body === null || body instanceof FormData) {
    throw new Error(`${tool.id}: expected a plain object body`)
  }
  return body as Record<string, unknown>
}

/**
 * Every Square write that carries an `idempotency_key`, with the minimum params
 * its body builder needs.
 *
 * The params are rebuilt per call rather than shared, so a token that only looks
 * stable because the object identity was reused cannot pass.
 */
const BODY_PLACEMENT_SITES: ReadonlyArray<{
  readonly tool: ToolConfig
  readonly params: () => Record<string, unknown>
}> = [
  {
    tool: squareCreatePaymentTool,
    params: () => ({ apiKey: 'k', sourceId: 'cnon:1', amount: 1000, currency: 'USD' }),
  },
  { tool: squareCreateCustomerTool, params: () => ({ apiKey: 'k', givenName: 'Ada' }) },
  { tool: squareCreateOrderTool, params: () => ({ apiKey: 'k', order: { location_id: 'L1' } }) },
  { tool: squarePayOrderTool, params: () => ({ apiKey: 'k', orderId: 'O1', paymentIds: ['P1'] }) },
  { tool: squareCreateInvoiceTool, params: () => ({ apiKey: 'k', invoice: { order_id: 'O1' } }) },
  { tool: squarePublishInvoiceTool, params: () => ({ apiKey: 'k', invoiceId: 'I1', version: 0 }) },
  {
    tool: squareRefundPaymentTool,
    params: () => ({ apiKey: 'k', paymentId: 'P1', amount: 500, currency: 'USD' }),
  },
  {
    tool: squareUpsertCatalogObjectTool,
    params: () => ({ apiKey: 'k', object: { type: 'ITEM', id: '#Coffee' } }),
  },
]

describe('square idempotency keys', () => {
  beforeEach(() => {
    mockWarn.mockClear()
  })

  describe.each(BODY_PLACEMENT_SITES.map((site) => [site.tool.id, site] as const))(
    '%s',
    (_id, site) => {
      it('derives the token from the execution identity, keyed to its own tool id', () => {
        const body = buildBody(site.tool, { ...site.params(), _context: { ...CONTEXT } })

        expect(body.idempotency_key).toBe(
          deriveDeliveryKey({ ...CONTEXT, toolId: site.tool.id }, site.tool.id)
        )
      })

      it('produces the same token when tool preparation is re-entered', () => {
        const first = buildBody(site.tool, { ...site.params(), _context: { ...CONTEXT } })
        const second = buildBody(site.tool, { ...site.params(), _context: { ...CONTEXT } })

        expect(second.idempotency_key).toBe(first.idempotency_key)
      })

      it('produces a different token for a different invocation of the same block', () => {
        const first = buildBody(site.tool, { ...site.params(), _context: { ...CONTEXT } })
        const second = buildBody(site.tool, {
          ...site.params(),
          _context: { ...CONTEXT, invocationId: '8' },
        })

        expect(second.idempotency_key).not.toBe(first.idempotency_key)
      })

      it('fits inside the tightest Square key length', () => {
        const body = buildBody(site.tool, { ...site.params(), _context: { ...CONTEXT } })

        expect(String(body.idempotency_key).length).toBeLessThanOrEqual(SQUARE_KEY_MAX_LENGTH)
      })

      it('honors a caller-supplied key untouched', () => {
        const body = buildBody(site.tool, {
          ...site.params(),
          idempotencyKey: 'pinned-by-the-builder',
          _context: { ...CONTEXT },
        })

        expect(body.idempotency_key).toBe('pinned-by-the-builder')
      })

      it('falls back to a fresh key and warns when the execution identity is incomplete', () => {
        const incomplete = { executionId: 'exec-1' }
        const first = buildBody(site.tool, { ...site.params(), _context: { ...incomplete } })
        const second = buildBody(site.tool, { ...site.params(), _context: { ...incomplete } })

        expect(first.idempotency_key).toEqual(expect.any(String))
        expect(second.idempotency_key).not.toBe(first.idempotency_key)
        expect(mockWarn).toHaveBeenCalledWith(
          expect.stringContaining('could not be derived'),
          expect.objectContaining({
            toolId: site.tool.id,
            missingContextFields: ['blockId', 'invocationId'],
          })
        )
      })
    }
  )

  describe('square_create_catalog_image', () => {
    const params = () => ({ apiKey: 'k', file: { key: 'f' }, fileName: 'a.png' })

    it('resolves the token on the tool side, where the execution identity exists', () => {
      const body = buildBody(squareCreateCatalogImageTool, {
        ...params(),
        _context: { ...CONTEXT },
      })

      expect(body.idempotencyKey).toBe(
        deriveDeliveryKey(
          { ...CONTEXT, toolId: squareCreateCatalogImageTool.id },
          squareCreateCatalogImageTool.id
        )
      )
    })

    it('sends the same token to the proxy route when tool preparation is re-entered', () => {
      const first = buildBody(squareCreateCatalogImageTool, {
        ...params(),
        _context: { ...CONTEXT },
      })
      const second = buildBody(squareCreateCatalogImageTool, {
        ...params(),
        _context: { ...CONTEXT },
      })

      expect(second.idempotencyKey).toBe(first.idempotencyKey)
      expect(first.idempotencyKey).toEqual(expect.any(String))
    })
  })
})
