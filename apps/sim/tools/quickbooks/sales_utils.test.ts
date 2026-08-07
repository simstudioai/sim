import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildQuickBooksCreatePaymentBody,
  buildQuickBooksUpdatePaymentBody,
  parseQuickBooksInvoiceAllocations,
  parseQuickBooksSalesLines,
} from '@/tools/quickbooks/sales_utils'
import { quickbooksUpdateCustomerPaymentTool } from '@/tools/quickbooks/update_customer_payment'

describe('QuickBooks sales monetary validation', () => {
  it.each([
    ['boolean', false],
    ['over-precision value', 1.001],
    ['non-finite value', Number.POSITIVE_INFINITY],
    ['unsafe magnitude', Number.MAX_SAFE_INTEGER],
  ])('rejects a %s before constructing a customer payment', (_name, totalAmount) => {
    expect(() =>
      buildQuickBooksCreatePaymentBody({
        accessToken: 'token',
        realmId: 'realm',
        customerId: 'customer-1',
        totalAmount: totalAmount as number,
      })
    ).toThrow()
  })

  it('preserves valid positive payment amounts and negative sales amounts', () => {
    expect(
      buildQuickBooksCreatePaymentBody({
        accessToken: 'token',
        realmId: 'realm',
        customerId: 'customer-1',
        totalAmount: 10.25,
        invoiceAllocations: [{ invoiceId: 'invoice-1', amount: 10.25 }],
      })
    ).toMatchObject({
      TotalAmt: 10.25,
      Line: [
        {
          Amount: 10.25,
          LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }],
        },
      ],
    })

    expect(
      parseQuickBooksSalesLines([
        {
          lineType: 'item',
          amount: -10.25,
          itemId: 'item-1',
          quantity: 1,
          unitPrice: -10.25,
        },
      ])
    ).toEqual([
      {
        lineType: 'item',
        amount: -10.25,
        itemId: 'item-1',
        description: undefined,
        quantity: 1,
        unitPrice: -10.25,
        serviceDate: undefined,
      },
    ])
  })

  it('accepts trimmed numeric strings without changing their numeric payload values', () => {
    expect(
      buildQuickBooksCreatePaymentBody({
        accessToken: 'token',
        realmId: 'realm',
        customerId: 'customer-1',
        totalAmount: ' 10.25 ' as unknown as number,
        invoiceAllocations: [{ invoiceId: 'invoice-1', amount: ' 10.25 ' as unknown as number }],
      })
    ).toMatchObject({ TotalAmt: 10.25, Line: [{ Amount: 10.25 }] })
  })
})

describe('QuickBooks customer payment allocations', () => {
  const duplicates = [
    { invoiceId: ' invoice-1 ', amount: 5 },
    { invoiceId: 'invoice-1', amount: 5 },
  ]

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects duplicate trimmed invoice IDs during parsing', () => {
    expect(() => parseQuickBooksInvoiceAllocations(duplicates)).toThrow(
      'invoiceAllocations lists invoice invoice-1 more than once'
    )
  })

  it('rejects duplicate invoice IDs for both create and update bodies', () => {
    expect(() =>
      buildQuickBooksCreatePaymentBody({
        accessToken: 'token',
        realmId: 'realm',
        customerId: 'customer-1',
        totalAmount: 10,
        invoiceAllocations: duplicates,
      })
    ).toThrow('invoiceAllocations lists invoice invoice-1 more than once')

    expect(() =>
      buildQuickBooksUpdatePaymentBody({
        accessToken: 'token',
        realmId: 'realm',
        paymentId: 'payment-1',
        syncToken: '0',
        totalAmount: 10,
        invoiceAllocations: duplicates,
        unapplyOmittedInvoices: true,
      })
    ).toThrow('invoiceAllocations lists invoice invoice-1 more than once')
  })

  it('rejects duplicate invoice IDs before the Update Payment preservation read', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      quickbooksUpdateCustomerPaymentTool.directExecution?.(
        {
          accessToken: 'token',
          realmId: 'realm',
          paymentId: 'payment-1',
          syncToken: '0',
          invoiceAllocations: duplicates,
        },
        undefined
      )
    ).rejects.toThrow('invoiceAllocations lists invoice invoice-1 more than once')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
