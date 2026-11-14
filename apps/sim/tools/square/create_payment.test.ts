/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { squareCreatePaymentTool } from '@/tools/square/create_payment'
import type { CreatePaymentParams } from '@/tools/square/types'

function buildBody(params: Record<string, unknown>): Record<string, unknown> {
  const body = squareCreatePaymentTool.request.body
  if (!body) throw new Error('square_create_payment must define a request body')
  return body({
    apiKey: 'token',
    sourceId: 'cnon:card',
    amount: 100,
    currency: 'USD',
    idempotencyKey: 'key-1',
    ...params,
  } as CreatePaymentParams) as Record<string, unknown>
}

describe('square_create_payment autocomplete', () => {
  it('omits an unset autocomplete so Square captures the payment by default', () => {
    expect(buildBody({ autocomplete: null })).not.toHaveProperty('autocomplete')
  })

  it('sends an explicit autocomplete choice', () => {
    expect(buildBody({ autocomplete: false }).autocomplete).toBe(false)
  })
})
