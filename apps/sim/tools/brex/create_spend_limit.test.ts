import { describe, expect, it } from 'vitest'
import { brexCreateSpendLimitTool } from '@/tools/brex/create_spend_limit'

const REQUIRED = {
  apiKey: 'token',
  name: 'Travel',
  periodRecurrenceType: 'PER_MONTH',
  spendType: 'BUDGET_PROVISIONED_CARDS_ONLY',
  expenseVisibility: 'SHARED',
  authorizationVisibility: 'PUBLIC',
  limitIncreaseSetting: 'DISABLED',
  autoTransferCardsSetting: 'DISABLED',
  autoCreateLimitCardsSetting: 'DISABLED',
  expensePolicyId: 'pol_1',
  baseLimitAmount: 50000,
  authorizationType: 'HARD',
  rolloverRefreshRate: 'OFF',
}

/** Builds the request body from canvas params the way a saved workflow delivers them, blanks included. */
function buildBody(overrides: Record<string, unknown>): Record<string, unknown> {
  const body = brexCreateSpendLimitTool.request.body
  if (!body) throw new Error('create_spend_limit has no request body builder')
  const result = body({ ...REQUIRED, ...overrides } as Parameters<typeof body>[0])
  if (typeof result !== 'object' || result instanceof FormData) {
    throw new Error('create_spend_limit must build a JSON object body')
  }
  return result
}

function authorizationSettings(body: Record<string, unknown>): Record<string, unknown> {
  return body.authorization_settings as Record<string, unknown>
}

describe('brexCreateSpendLimitTool request body', () => {
  it.each([null, '', '   '])(
    'omits limit_buffer_percentage when the saved value is %j instead of sending 0',
    (blank) => {
      const body = buildBody({ limitBufferPercentage: blank })
      expect(authorizationSettings(body)).not.toHaveProperty('limit_buffer_percentage')
    }
  )

  it('sends an explicit 0 buffer the user set', () => {
    const body = buildBody({ limitBufferPercentage: 0 })
    expect(authorizationSettings(body).limit_buffer_percentage).toBe(0)
  })

  it.each([null, '', '   '])(
    'omits transaction_limit when the saved amount is %j instead of sending a null Money amount',
    (blank) => {
      const body = buildBody({ transactionLimitAmount: blank })
      expect(body).not.toHaveProperty('transaction_limit')
    }
  )

  it('sends a set transaction limit in the spend limit currency', () => {
    const body = buildBody({ transactionLimitAmount: 2500, currency: 'EUR' })
    expect(body.transaction_limit).toEqual({ amount: 2500, currency: 'EUR' })
  })
})
