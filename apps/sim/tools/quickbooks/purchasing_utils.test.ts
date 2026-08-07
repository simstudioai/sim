import { describe, expect, it } from 'vitest'
import {
  buildQuickBooksCreateBillBody,
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
