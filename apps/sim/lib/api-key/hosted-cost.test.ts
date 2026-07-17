/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordUsed, mockRecordCostCharged } = vi.hoisted(() => ({
  mockRecordUsed: vi.fn(),
  mockRecordCostCharged: vi.fn(),
}))

vi.mock('@/lib/monitoring/metrics', () => ({
  hostedKeyMetrics: {
    recordUsed: mockRecordUsed,
    recordCostCharged: mockRecordCostCharged,
  },
}))

import {
  calculateHostedCost,
  classifyHostedKeyFailure,
  emitHostedKeyUsage,
} from '@/lib/api-key/hosted-cost'

describe('calculateHostedCost (tool pricing)', () => {
  it('per_request returns the flat fee', () => {
    expect(calculateHostedCost({ type: 'per_request', cost: 0.005 }, {}, {})).toEqual({
      cost: 0.005,
    })
  })

  it('custom returns a numeric getCost result', () => {
    const pricing = { type: 'custom' as const, getCost: () => 0.42 }
    expect(calculateHostedCost(pricing, {}, {})).toEqual({ cost: 0.42 })
  })

  it('custom passes through a structured getCost result with metadata', () => {
    const pricing = {
      type: 'custom' as const,
      getCost: () => ({ cost: 1.5, metadata: { units: 3 } }),
    }
    expect(calculateHostedCost(pricing, {}, {})).toEqual({ cost: 1.5, metadata: { units: 3 } })
  })

  it('forwards params and response to custom getCost', () => {
    const getCost = vi.fn(() => 1)
    const params = { a: 1 }
    const response = { b: 2 }
    calculateHostedCost({ type: 'custom', getCost }, params, response)
    expect(getCost).toHaveBeenCalledWith(params, response)
  })
})

describe('classifyHostedKeyFailure', () => {
  it('classifies structured SDK errors by status', () => {
    expect(classifyHostedKeyFailure({ status: 429 })).toBe('rate_limited')
    expect(classifyHostedKeyFailure({ status: 503 })).toBe('rate_limited')
    expect(classifyHostedKeyFailure({ status: 401 })).toBe('auth')
    expect(classifyHostedKeyFailure({ status: 403, message: 'quota exceeded' })).toBe(
      'rate_limited'
    )
    expect(classifyHostedKeyFailure({ status: 500 })).toBe('other')
  })

  it('classifies message-embedded status (provider errors with no .status)', () => {
    // Regression: the previous `\bunauthor\b` regex never matched "Unauthorized".
    expect(classifyHostedKeyFailure(new Error('Unauthorized'))).toBe('auth')
    expect(classifyHostedKeyFailure(new Error('OpenAI API error (401): bad key'))).toBe('auth')
    expect(classifyHostedKeyFailure(new Error('Forbidden'))).toBe('auth')
    expect(classifyHostedKeyFailure(new Error('Invalid API key provided'))).toBe('auth')
    expect(classifyHostedKeyFailure(new Error('API error (429): rate limit'))).toBe('rate_limited')
    expect(classifyHostedKeyFailure(new Error('Internal Server Error (500)'))).toBe('other')
  })
})

describe('emitHostedKeyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records both usage and cost with the provider/tool/key labels', () => {
    emitHostedKeyUsage({
      provider: 'openai',
      tool: 'gpt-4o',
      key: 'OPENAI_API_KEY_2',
      costTotal: 0.03,
    })

    expect(mockRecordUsed).toHaveBeenCalledWith({
      provider: 'openai',
      tool: 'gpt-4o',
      key: 'OPENAI_API_KEY_2',
    })
    expect(mockRecordCostCharged).toHaveBeenCalledWith(0.03, { provider: 'openai', tool: 'gpt-4o' })
  })
})
