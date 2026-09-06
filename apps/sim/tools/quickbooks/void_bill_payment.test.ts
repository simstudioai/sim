/**
 * @vitest-environment node
 */
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
  it('posts to the documented void operation', () => {
    const url = new URL(quickbooksVoidBillPaymentTool.request.url(PARAMS))

    expect(url.pathname).toContain('/billpayment')
    expect(url.searchParams.get('operation')).toBe('update')
    expect(url.searchParams.get('include')).toBe('void')
    expect(quickbooksVoidBillPaymentTool.request.method).toBe('POST')
  })

  it('sends the minimum documented void body', () => {
    expect(quickbooksVoidBillPaymentTool.request.body?.(PARAMS)).toEqual({
      Id: 'payment-1',
      SyncToken: '2',
      sparse: true,
    })
  })

  it('refuses to void without explicit confirmation', () => {
    expect(() =>
      quickbooksVoidBillPaymentTool.request.body?.({ ...PARAMS, confirmVoid: false })
    ).toThrow('Confirm void before voiding the bill payment')
  })
})
