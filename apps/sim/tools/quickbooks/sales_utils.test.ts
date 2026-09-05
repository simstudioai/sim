import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeQuickBooksUpdateCustomerPaymentOperation } from '@/lib/internal/quickbooks/provider-operations'

vi.mock('@/lib/core/config/env', () => ({
  env: { QUICKBOOKS_ENV: 'production' },
}))

import {
  buildQuickBooksCreatePaymentBody,
  buildQuickBooksUpdatePaymentBody,
  parseQuickBooksInvoiceAllocations,
  parseQuickBooksSalesLines,
} from '@/tools/quickbooks/sales_utils'
import { getQuickBooksOperationError } from '@/tools/quickbooks/utils'

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

describe('QuickBooks operation fault extraction', () => {
  it('surfaces a documented QueryResponse fault on a failed query request', async () => {
    const error = await getQuickBooksOperationError(
      Response.json(
        {
          QueryResponse: {
            Fault: { Error: [{ code: '4000', Message: 'Invalid query' }] },
          },
        },
        { status: 400 }
      ),
      'Payment'
    )

    expect(error.message).toContain('4000: Invalid query')
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

  it('requires explicit allocations before unapplying omitted invoices', () => {
    expect(() =>
      buildQuickBooksUpdatePaymentBody({
        accessToken: 'token',
        realmId: 'realm',
        paymentId: 'payment-1',
        syncToken: '0',
        unapplyOmittedInvoices: true,
      })
    ).toThrow('invoiceAllocations is required when unapplyOmittedInvoices is true')
  })

  it('uses the current payment total when replacing allocations without a new total', () => {
    expect(
      buildQuickBooksUpdatePaymentBody(
        {
          accessToken: 'token',
          realmId: 'realm',
          paymentId: 'payment-1',
          syncToken: '0',
          invoiceAllocations: [{ invoiceId: 'invoice-2', amount: 8 }],
          unapplyOmittedInvoices: true,
        },
        { Id: 'payment-1', TotalAmt: 10 }
      )
    ).toMatchObject({
      Line: [{ Amount: 8, LinkedTxn: [{ TxnId: 'invoice-2', TxnType: 'Invoice' }] }],
    })
  })

  it('rejects lowering the payment total below preserved allocations', () => {
    expect(() =>
      buildQuickBooksUpdatePaymentBody(
        {
          accessToken: 'token',
          realmId: 'realm',
          paymentId: 'payment-1',
          syncToken: '0',
          totalAmount: 9,
        },
        {
          Id: 'payment-1',
          TotalAmt: 10,
          Line: [
            {
              Amount: 10,
              LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }],
            },
          ],
        }
      )
    ).toThrow('Existing invoice allocation amounts cannot exceed totalAmount')
  })

  it('rejects duplicate invoice IDs before the Update Payment preservation read', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeQuickBooksUpdateCustomerPaymentOperation(
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

  it('reads and preserves the complete Payment for every documented full update', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          Payment: {
            Id: 'payment-1',
            SyncToken: '2',
            CustomerRef: { value: 'customer-1' },
            TotalAmt: 25,
            Line: [
              {
                Amount: 25,
                LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }],
              },
            ],
            PrivateNote: 'Old note',
            MetaData: { CreateTime: '2026-08-01T00:00:00Z' },
            domain: 'QBO',
            sparse: false,
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          Payment: { Id: 'payment-1', SyncToken: '3', TotalAmt: 25 },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await executeQuickBooksUpdateCustomerPaymentOperation(
      {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        paymentId: 'payment-1',
        syncToken: '2',
        privateNote: 'New note',
      },
      undefined
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      Id: 'payment-1',
      SyncToken: '2',
      CustomerRef: { value: 'customer-1' },
      TotalAmt: 25,
      Line: [
        {
          Amount: 25,
          LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }],
        },
      ],
      PrivateNote: 'New note',
    })
  })
})
