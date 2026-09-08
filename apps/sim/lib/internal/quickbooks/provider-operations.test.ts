/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: { QUICKBOOKS_ENV: 'production' },
}))

import {
  executeQuickBooksCreateBillPaymentOperation,
  executeQuickBooksUpdateRefundReceiptOperation,
} from '@/lib/internal/quickbooks/provider-operations'

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

  it('refuses a Credit Card account whose sub-type is not the documented CreditCard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        Account: {
          Id: 'account-1',
          SyncToken: '0',
          AccountType: 'Credit Card',
          AccountSubType: 'LineOfCredit',
        },
      })
    )

    await expect(
      executeQuickBooksCreateBillPaymentOperation(billPaymentParams('credit_card'))
    ).rejects.toThrow('CreditCard sub-type')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('accepts the documented Bank/Checking pair', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          Account: {
            Id: 'account-1',
            SyncToken: '0',
            AccountType: 'Bank',
            AccountSubType: 'Checking',
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ BillPayment: { Id: 'pay-1', SyncToken: '0' } }))

    const result = await executeQuickBooksCreateBillPaymentOperation(billPaymentParams('check'))
    expect(result.output.recordId).toBe('pay-1')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('QuickBooks refund receipt sparse update', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the documented sparse body without reading the record first', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ RefundReceipt: { Id: 'refund-1', SyncToken: '3' } })
    )

    const result = await executeQuickBooksUpdateRefundReceiptOperation({
      ...AUTH,
      transactionId: 'refund-1',
      syncToken: '2',
      lines: [{ lineType: 'item', amount: 10, itemId: 'item-1' }],
    })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []
    expect(String(url)).toContain('/refundreceipt')
    expect(String(init?.method)).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      Id: 'refund-1',
      SyncToken: '2',
      sparse: true,
      Line: [
        {
          Amount: 10,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
        },
      ],
    })
    expect(result.output.syncToken).toBe('3')
  })
})
