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
import { brexCreateBudgetTool } from '@/tools/brex/create_budget'
import { brexCreateSpendLimitTool } from '@/tools/brex/create_spend_limit'
import { brexCreateTransferTool } from '@/tools/brex/create_transfer'
import { brexCreateVendorTool } from '@/tools/brex/create_vendor'
import { brexUpdateVendorTool } from '@/tools/brex/update_vendor'
import type { ToolConfig } from '@/tools/types'

/** A complete execution identity, as the executor is expected to inject it. */
const CONTEXT = {
  executionId: 'exec-1',
  blockId: 'block-1',
  invocationId: '7',
} as const

/**
 * Every Brex write that carries an `Idempotency-Key`, with the minimum params
 * its header builder needs.
 *
 * Params are rebuilt per call rather than shared, so a token that only looks
 * stable because the object identity was reused cannot pass.
 */
const SITES: ReadonlyArray<{
  readonly tool: ToolConfig
  readonly params: () => Record<string, unknown>
}> = [
  { tool: brexCreateTransferTool, params: () => ({ apiKey: 'k' }) },
  { tool: brexCreateVendorTool, params: () => ({ apiKey: 'k' }) },
  { tool: brexCreateBudgetTool, params: () => ({ apiKey: 'k' }) },
  { tool: brexCreateSpendLimitTool, params: () => ({ apiKey: 'k' }) },
  { tool: brexUpdateVendorTool, params: () => ({ apiKey: 'k', vendorId: 'V1' }) },
]

describe('brex idempotency keys', () => {
  beforeEach(() => {
    mockWarn.mockClear()
  })

  describe.each(SITES.map((site) => [site.tool.id, site] as const))('%s', (_id, site) => {
    it('derives the header from the execution identity, keyed to its own tool id', () => {
      const headers = site.tool.request.headers({ ...site.params(), _context: { ...CONTEXT } })

      expect(headers['Idempotency-Key']).toBe(
        deriveDeliveryKey({ ...CONTEXT, toolId: site.tool.id }, site.tool.id)
      )
    })

    it('produces the same header when tool preparation is re-entered', () => {
      const first = site.tool.request.headers({ ...site.params(), _context: { ...CONTEXT } })
      const second = site.tool.request.headers({ ...site.params(), _context: { ...CONTEXT } })

      expect(second['Idempotency-Key']).toBe(first['Idempotency-Key'])
    })

    it('produces a different header for a different invocation of the same block', () => {
      const first = site.tool.request.headers({ ...site.params(), _context: { ...CONTEXT } })
      const second = site.tool.request.headers({
        ...site.params(),
        _context: { ...CONTEXT, invocationId: '8' },
      })

      expect(second['Idempotency-Key']).not.toBe(first['Idempotency-Key'])
    })

    it('keeps the authorization headers alongside the token', () => {
      const headers = site.tool.request.headers({ ...site.params(), _context: { ...CONTEXT } })

      expect(headers.Authorization).toBe('Bearer k')
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('falls back to a fresh header and warns when the execution identity is incomplete', () => {
      const incomplete = { executionId: 'exec-1' }
      const first = site.tool.request.headers({ ...site.params(), _context: { ...incomplete } })
      const second = site.tool.request.headers({ ...site.params(), _context: { ...incomplete } })

      expect(first['Idempotency-Key']).toEqual(expect.any(String))
      expect(second['Idempotency-Key']).not.toBe(first['Idempotency-Key'])
      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('could not be derived'),
        expect.objectContaining({
          toolId: site.tool.id,
          missingContextFields: ['blockId', 'invocationId'],
        })
      )
    })
  })
})
