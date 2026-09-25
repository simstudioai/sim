import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: { QUICKBOOKS_ENV: 'production' },
}))

import { executeQuickBooksCreateBillPaymentOperation } from '@/lib/internal/quickbooks/provider-operations'

const AUTH = {
  accessToken: 'token',
  realmId: '123',
  quickBooksEnvironment: 'sandbox',
} as const

function billPaymentParams(paymentType: 'check' | 'credit_card') {
  return {
    ...AUTH,
    vendorId: 'vendor-1',
    paymentType,
    paymentAccountId: 'account-1',
    billAllocations: [{ billId: 'bill-1', amount: 10 }],
    totalAmount: 10,
  }
}

describe('QuickBooks bill payment account compatibility', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses a Bank account whose sub-type is not the documented Checking', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        Account: {
          Id: 'account-1',
          SyncToken: '0',
          AccountType: 'Bank',
          AccountSubType: 'Savings',
        },
      })
    )

    await expect(
      executeQuickBooksCreateBillPaymentOperation(billPaymentParams('check'))
    ).rejects.toThrow('Checking sub-type')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
