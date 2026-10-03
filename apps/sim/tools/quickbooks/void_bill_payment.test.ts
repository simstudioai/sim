import { describe, expect, it } from 'vitest'
import type { QuickBooksVoidTransactionParams } from '@/tools/quickbooks/types'
import { quickbooksVoidBillPaymentTool } from '@/tools/quickbooks/void_bill_payment'

const PARAMS: QuickBooksVoidTransactionParams = {
  accessToken: 'token',
  realmId: '123',
  quickBooksEnvironment: 'sandbox',
  transactionId: 'payment-1',
  syncToken: '2',
  confirmVoid: true,
}

describe('QuickBooks Void Bill Payment', () => {
  it('refuses to void without explicit confirmation', () => {
    expect(() =>
      quickbooksVoidBillPaymentTool.request.body?.({ ...PARAMS, confirmVoid: false })
    ).toThrow('Confirm void before voiding the bill payment')
  })
})
