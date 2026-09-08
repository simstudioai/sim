import { describe, expect, it } from 'vitest'
import { quickbooksCreatePurchaseOrderTool } from '@/tools/quickbooks/create_purchase_order'
import {
  buildQuickBooksCreateBillBody,
  buildQuickBooksCreateBillPaymentBody,
  buildQuickBooksCreatePurchaseBody,
  buildQuickBooksCreatePurchaseOrderBody,
  buildQuickBooksUpdateBillBody,
  buildQuickBooksUpdateBillPaymentBody,
  buildQuickBooksUpdatePurchaseBody,
  buildQuickBooksUpdateVendorCreditBody,
  verifyQuickBooksBillLinks,
} from '@/tools/quickbooks/purchasing_utils'
import type { QuickBooksCreateBillParams } from '@/tools/quickbooks/types'

const BASE_PARAMS: QuickBooksCreateBillParams = {
  accessToken: 'token',
  realmId: 'realm',
  vendorId: 'vendor-1',
  lines: [{ lineType: 'account', amount: 20, accountId: 'account-1' }],
}

describe('QuickBooks Create Bill Purchase Order linking', () => {
  it('keeps the standalone Bill payload free of linked transactions', () => {
    const body = buildQuickBooksCreateBillBody(BASE_PARAMS)

    expect(body).not.toHaveProperty('LinkedTxn')
    expect(body.Line).toEqual([
      {
        Amount: 20,
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: 'account-1' },
        },
      },
    ])
  })

  it('adds unique transaction-level PO links and exact line-level PO links', () => {
    const body = buildQuickBooksCreateBillBody({
      ...BASE_PARAMS,
      lines: [
        {
          lineType: 'account',
          amount: 10,
          accountId: 'account-1',
          purchaseOrderId: ' po-2 ',
          purchaseOrderLineId: ' line-1 ',
        },
        {
          lineType: 'account',
          amount: 5,
          accountId: 'account-1',
          purchaseOrderId: 'po-2',
          purchaseOrderLineId: 'line-2',
        },
        { lineType: 'account', amount: 3, accountId: 'account-1' },
        {
          lineType: 'item',
          amount: 2,
          itemId: 'item-1',
          purchaseOrderId: 'po-1',
          purchaseOrderLineId: 'line-3',
        },
      ],
    })

    expect(body.LinkedTxn).toEqual([
      { TxnId: 'po-2', TxnType: 'PurchaseOrder' },
      { TxnId: 'po-1', TxnType: 'PurchaseOrder' },
    ])
    expect(body.Line).toMatchObject([
      {
        LinkedTxn: [{ TxnId: 'po-2', TxnType: 'PurchaseOrder', TxnLineId: 'line-1' }],
      },
      {
        LinkedTxn: [{ TxnId: 'po-2', TxnType: 'PurchaseOrder', TxnLineId: 'line-2' }],
      },
      { Amount: 3 },
      {
        LinkedTxn: [{ TxnId: 'po-1', TxnType: 'PurchaseOrder', TxnLineId: 'line-3' }],
      },
    ])
    expect((body.Line as Array<Record<string, unknown>>)[2]).not.toHaveProperty('LinkedTxn')
  })

  it('reports successful linkage when QuickBooks returns every requested pair', () => {
    const lines = [
      {
        lineType: 'account' as const,
        amount: 20,
        accountId: 'account-1',
        purchaseOrderId: 'po-1',
        purchaseOrderLineId: 'po-line-1',
      },
    ]

    expect(
      verifyQuickBooksBillLinks(
        {
          Id: 'bill-1',
          Line: [
            {
              Id: 'bill-line-1',
              LinkedTxn: [
                {
                  TxnId: 'po-1',
                  TxnType: 'PurchaseOrder',
                  TxnLineId: 'po-line-1',
                },
              ],
            },
          ],
        },
        lines,
        'bill-1'
      )
    ).toEqual({
      linkingRequested: true,
      linkingSucceeded: true,
      linkedLines: [
        {
          purchaseOrderId: 'po-1',
          purchaseOrderLineId: 'po-line-1',
          billLineId: 'bill-line-1',
        },
      ],
      missingLinks: [],
    })
  })
})

describe('QuickBooks BillPayment allocation behavior', () => {
  const payment = {
    accessToken: 'token',
    realmId: '123',
    quickBooksEnvironment: 'sandbox',
    vendorId: 'vendor-1',
    totalAmount: 100,
    paymentType: 'check' as const,
    paymentAccountId: 'bank-1',
  }

  it('sends the required Line field when an unallocated payment becomes vendor credit', () => {
    expect(buildQuickBooksCreateBillPaymentBody(payment)).toMatchObject({ Line: [] })
  })

  it('allows allocations below totalAmount and rejects allocations above it', () => {
    expect(
      buildQuickBooksCreateBillPaymentBody({
        ...payment,
        billAllocations: [{ billId: 'bill-1', amount: 75 }],
      })
    ).toMatchObject({ TotalAmt: 100, Line: [{ Amount: 75 }] })

    expect(() =>
      buildQuickBooksCreateBillPaymentBody({
        ...payment,
        billAllocations: [{ billId: 'bill-1', amount: 125 }],
      })
    ).toThrow('cannot exceed totalAmount')
  })
})

describe('QuickBooks multicurrency and non-US tax fields on creates', () => {
  it('emits CurrencyRef and GlobalTaxCalculation on a Bill when they are supplied', () => {
    expect(
      buildQuickBooksCreateBillBody({
        ...BASE_PARAMS,
        currencyCode: 'cad',
        globalTaxCalculation: 'TaxInclusive',
      })
    ).toMatchObject({
      CurrencyRef: { value: 'CAD' },
      GlobalTaxCalculation: 'TaxInclusive',
    })
  })

  it('omits both fields when they are not supplied', () => {
    const body = buildQuickBooksCreateBillBody(BASE_PARAMS)

    expect(body).not.toHaveProperty('CurrencyRef')
    expect(body).not.toHaveProperty('GlobalTaxCalculation')
  })

  it('rejects a currency code that is not three letters and an undocumented tax value', () => {
    expect(() => buildQuickBooksCreateBillBody({ ...BASE_PARAMS, currencyCode: 'CANADA' })).toThrow(
      'ISO 4217'
    )
    expect(() =>
      buildQuickBooksCreateBillBody({ ...BASE_PARAMS, globalTaxCalculation: 'Inclusive' })
    ).toThrow('globalTaxCalculation must be one of')
  })

  it('emits CurrencyRef, DocNumber, and APAccountRef on a BillPayment', () => {
    expect(
      buildQuickBooksCreateBillPaymentBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        vendorId: 'vendor-1',
        totalAmount: 100,
        paymentType: 'check',
        paymentAccountId: 'bank-1',
        apAccountId: 'ap-1',
        currencyCode: 'GBP',
        documentNumber: 'CHK-1001',
      })
    ).toMatchObject({
      CurrencyRef: { value: 'GBP' },
      APAccountRef: { value: 'ap-1' },
      DocNumber: 'CHK-1001',
    })
  })

  it('emits CurrencyRef on a Purchase', () => {
    expect(
      buildQuickBooksCreatePurchaseBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        paymentType: 'cash',
        paymentAccountId: 'bank-1',
        lines: [{ lineType: 'account', amount: 20, accountId: 'account-1' }],
        currencyCode: 'EUR',
      })
    ).toMatchObject({ CurrencyRef: { value: 'EUR' } })
  })
})

describe('QuickBooks item-based expense lines', () => {
  it('accepts an item line without an itemId, as ItemRef is optional', () => {
    const body = buildQuickBooksCreateBillBody({
      ...BASE_PARAMS,
      lines: [{ lineType: 'item', amount: 20 }],
    })

    expect(body.Line).toEqual([
      {
        Amount: 20,
        DetailType: 'ItemBasedExpenseLineDetail',
        ItemBasedExpenseLineDetail: {},
      },
    ])
  })
})

describe('QuickBooks Purchase Order due date', () => {
  it('exposes dueDate so the DueDate the builder already sends is reachable', () => {
    expect(quickbooksCreatePurchaseOrderTool.params.dueDate).toMatchObject({
      type: 'string',
      required: false,
    })
  })

  it('sends DueDate on a created Purchase Order', () => {
    expect(
      buildQuickBooksCreatePurchaseOrderBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        vendorId: 'vendor-1',
        apAccountId: 'ap-1',
        lines: [{ lineType: 'account', amount: 20, accountId: 'account-1' }],
        dueDate: '2026-01-31',
      })
    ).toMatchObject({ DueDate: '2026-01-31' })
  })
})

describe('QuickBooks Purchase full-update patch', () => {
  it('does not require or overwrite the current PaymentType', () => {
    expect(
      buildQuickBooksUpdatePurchaseBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        purchaseId: 'purchase-1',
        syncToken: '2',
        privateNote: 'Updated note',
      })
    ).toEqual({
      Id: 'purchase-1',
      SyncToken: '2',
      sparse: true,
      PrivateNote: 'Updated note',
    })
  })
})

describe('QuickBooks payable full-update patches', () => {
  it('preserves the current vendor when no replacement vendor is supplied', () => {
    expect(
      buildQuickBooksUpdateBillBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        billId: 'bill-1',
        syncToken: '2',
        privateNote: 'Updated bill',
      })
    ).toEqual({
      Id: 'bill-1',
      SyncToken: '2',
      sparse: true,
      PrivateNote: 'Updated bill',
    })
    expect(
      buildQuickBooksUpdateBillPaymentBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        billPaymentId: 'payment-1',
        syncToken: '2',
        privateNote: 'Updated payment',
      })
    ).toEqual({
      Id: 'payment-1',
      SyncToken: '2',
      sparse: true,
      PrivateNote: 'Updated payment',
    })
    expect(
      buildQuickBooksUpdateVendorCreditBody({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        vendorCreditId: 'credit-1',
        syncToken: '2',
        privateNote: 'Updated credit',
      })
    ).toEqual({
      Id: 'credit-1',
      SyncToken: '2',
      sparse: true,
      PrivateNote: 'Updated credit',
    })
  })
})
