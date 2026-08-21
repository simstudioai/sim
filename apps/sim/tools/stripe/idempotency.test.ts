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
import * as stripeToolModule from '@/tools/stripe'
import { STRIPE_UNKEYED_DELIVERY } from '@/tools/stripe/idempotency'
import type { ToolConfig } from '@/tools/types'

/** Stripe's header, exactly as it must appear on the wire. */
const IDEMPOTENCY_HEADER = 'Idempotency-Key'

/** A complete execution identity, as the executor is expected to inject it. */
const CONTEXT = {
  executionId: 'exec-1',
  blockId: 'block-1',
  invocationId: '7',
} as const

/** Stripe's documented ceiling: "Idempotency keys are up to 255 characters long." */
const STRIPE_KEY_MAX_LENGTH = 255

/**
 * How many Stripe tools sit on each side of the classification, pinned so the
 * per-tool suites below cannot pass vacuously.
 *
 * `describe.each` over an empty list is a green run that asserted nothing, and
 * the list is derived from a barrel — one broken export and every check here
 * silently stops covering the payments provider it exists to cover. Adding a
 * Stripe tool fails these until its verb is classified on purpose, which for a
 * payments provider is the right amount of friction.
 */
const KEYED_TOOL_COUNT = 23
const UNKEYED_TOOL_COUNT = 27

function isStripeTool(value: unknown): value is ToolConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ToolConfig>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.startsWith('stripe_') &&
    typeof candidate.request === 'object' &&
    candidate.request !== null
  )
}

const STRIPE_TOOLS = Object.values(stripeToolModule).filter(isStripeTool)

/**
 * Calls a tool's header builder the way tool preparation does.
 *
 * Reading `request.headers` is confined to the canonical transport in production
 * source; `check-tool-request-boundary.ts` exempts test files precisely so a
 * request shape can be asserted without a live transport.
 */
function buildHeaders(tool: ToolConfig, params: Record<string, unknown>): Record<string, string> {
  const headers = tool.request.headers?.(params)
  if (!headers) throw new Error(`${tool.id}: expected request headers`)
  return headers as Record<string, string>
}

function methodOf(tool: ToolConfig): string {
  const { method } = tool.request
  if (typeof method !== 'string') {
    throw new Error(`${tool.id}: expected a literal request method to classify its delivery`)
  }
  return method
}

/** The only param every Stripe header builder reads. */
const params = () => ({ apiKey: 'sk_test_1' })

const KEYED_TOOLS = STRIPE_TOOLS.filter((tool) => methodOf(tool) === 'POST')
const UNKEYED_TOOLS = STRIPE_TOOLS.filter((tool) => methodOf(tool) !== 'POST')

describe('stripe delivery classification', () => {
  it('covers every exported Stripe tool on one side or the other', () => {
    expect(KEYED_TOOLS).toHaveLength(KEYED_TOOL_COUNT)
    expect(UNKEYED_TOOLS).toHaveLength(UNKEYED_TOOL_COUNT)
    expect(STRIPE_TOOLS).toHaveLength(KEYED_TOOL_COUNT + UNKEYED_TOOL_COUNT)
  })

  it('declares a delivery class for every non-POST verb Stripe tools use', () => {
    const undeclared = UNKEYED_TOOLS.filter((tool) => !(methodOf(tool) in STRIPE_UNKEYED_DELIVERY))

    expect(undeclared.map((tool) => `${tool.id} (${methodOf(tool)})`)).toEqual([])
  })

  it('classifies reads and deletes as Stripe itself does', () => {
    expect(STRIPE_UNKEYED_DELIVERY.GET.deliveryClass).toBe('read')
    expect(STRIPE_UNKEYED_DELIVERY.DELETE.deliveryClass).toBe('converge')
  })
})

describe('stripe idempotency keys', () => {
  beforeEach(() => {
    mockWarn.mockClear()
  })

  describe.each(KEYED_TOOLS.map((tool) => [tool.id, tool] as const))('%s', (_id, tool) => {
    it('derives the token from the execution identity, keyed to its own tool id', () => {
      const headers = buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })

      expect(headers[IDEMPOTENCY_HEADER]).toBe(
        deriveDeliveryKey({ ...CONTEXT, toolId: tool.id }, tool.id)
      )
    })

    it('produces the same token when tool preparation is re-entered', () => {
      const first = buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })
      const second = buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })

      expect(second[IDEMPOTENCY_HEADER]).toBe(first[IDEMPOTENCY_HEADER])
    })

    it('produces a different token for a different invocation of the same block', () => {
      const first = buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })
      const second = buildHeaders(tool, {
        ...params(),
        _context: { ...CONTEXT, invocationId: '8' },
      })

      expect(second[IDEMPOTENCY_HEADER]).not.toBe(first[IDEMPOTENCY_HEADER])
    })

    it('fits inside the Stripe key length', () => {
      const headers = buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })

      expect(headers[IDEMPOTENCY_HEADER].length).toBeLessThanOrEqual(STRIPE_KEY_MAX_LENGTH)
    })

    it('falls back to a fresh key and warns when the execution identity is incomplete', () => {
      const incomplete = { executionId: 'exec-1' }
      const first = buildHeaders(tool, { ...params(), _context: { ...incomplete } })
      const second = buildHeaders(tool, { ...params(), _context: { ...incomplete } })

      expect(first[IDEMPOTENCY_HEADER]).toEqual(expect.any(String))
      expect(second[IDEMPOTENCY_HEADER]).not.toBe(first[IDEMPOTENCY_HEADER])
      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining('could not be derived'),
        expect.objectContaining({
          toolId: tool.id,
          missingContextFields: ['blockId', 'invocationId'],
        })
      )
    })
  })

  it('gives two Stripe writes in one invocation two different tokens', () => {
    const tokens = KEYED_TOOLS.map(
      (tool) => buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })[IDEMPOTENCY_HEADER]
    )

    expect(new Set(tokens).size).toBe(KEYED_TOOLS.length)
  })

  describe.each(UNKEYED_TOOLS.map((tool) => [tool.id, tool] as const))('%s', (_id, tool) => {
    /**
     * Stripe: "Don't send idempotency keys in `GET` and `DELETE` requests
     * because it has no effect." A token here would read to every later reviewer
     * as a dedupe guarantee the provider never made.
     */
    it('sends no idempotency token, which Stripe ignores on this verb', () => {
      const headers = buildHeaders(tool, { ...params(), _context: { ...CONTEXT } })

      expect(headers).not.toHaveProperty(IDEMPOTENCY_HEADER)
      expect(mockWarn).not.toHaveBeenCalled()
    })
  })
})
