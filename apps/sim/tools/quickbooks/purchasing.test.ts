import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import {
  quickbooksCreateBillPaymentTool,
  quickbooksCreateBillTool,
  quickbooksCreatePurchaseOrderTool,
  quickbooksCreatePurchaseTool,
  quickbooksCreateVendorCreditTool,
  quickbooksReadPurchasingTransactionsTool,
  quickbooksUpdateBillPaymentTool,
  quickbooksUpdateBillTool,
  quickbooksUpdatePurchaseOrderTool,
  quickbooksUpdatePurchaseTool,
  quickbooksUpdateVendorCreditTool,
} from '@/tools/quickbooks'
import {
  buildQuickBooksCreateBillBody,
  buildQuickBooksCreateBillPaymentBody,
  buildQuickBooksCreatePurchaseBody,
  buildQuickBooksCreatePurchaseOrderBody,
  buildQuickBooksCreateVendorCreditBody,
  buildQuickBooksUpdateBillBody,
  buildQuickBooksUpdateBillPaymentBody,
  buildQuickBooksUpdatePurchaseBody,
  buildQuickBooksUpdatePurchaseOrderBody,
  buildQuickBooksUpdateVendorCreditBody,
  parseQuickBooksBillAllocations,
  parseQuickBooksPurchasingLines,
} from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksCreateBillPaymentParams,
  QuickBooksCreatePurchaseOrderParams,
  QuickBooksCreatePurchaseParams,
  QuickBooksReadPurchasingTransactionsParams,
} from '@/tools/quickbooks/types'

const authParams = { accessToken: 'access-token', realmId: '123456789' }
const accountLine = {
  lineType: 'account' as const,
  amount: 125,
  accountId: '7',
  description: 'Sanitized supplies',
}
const itemLine = {
  lineType: 'item' as const,
  amount: 60,
  itemId: '21',
  description: 'Sanitized equipment',
  quantity: 3,
  unitPrice: 20,
}

beforeEach(() => setEnv({ QUICKBOOKS_ENV: 'sandbox' }))
afterEach(resetEnvMock)

describe('QuickBooks purchasing reader', () => {
  const listParams: QuickBooksReadPurchasingTransactionsParams = {
    ...authParams,
    transactionType: 'bill',
    readMode: 'list',
    startPosition: 3,
    maxResults: 25,
  }

  it.each([
    ['purchase_order', 'PurchaseOrder', 'purchaseorder'],
    ['bill', 'Bill', 'bill'],
    ['bill_payment', 'BillPayment', 'billpayment'],
    ['vendor_credit', 'VendorCredit', 'vendorcredit'],
    ['purchase', 'Purchase', 'purchase'],
  ] as const)('maps %s to fixed list and by-ID contracts', (transactionType, entity, resource) => {
    const requestUrl = quickbooksReadPurchasingTransactionsTool.request.url as (
      params: QuickBooksReadPurchasingTransactionsParams
    ) => string
    const listUrl = new URL(requestUrl({ ...listParams, transactionType }))
    expect(listUrl.pathname).toBe('/v3/company/123456789/query')
    expect(listUrl.searchParams.get('query')).toBe(
      `SELECT * FROM ${entity} STARTPOSITION 3 MAXRESULTS 25`
    )
    expect(listUrl.searchParams.get('minorversion')).toBe('75')

    const byIdUrl = new URL(
      requestUrl({
        ...listParams,
        transactionType,
        readMode: 'by_id',
        transactionId: ' A/B ',
      })
    )
    expect(byIdUrl.pathname).toBe(`/v3/company/123456789/${resource}/A%2FB`)
  })

  it('preserves verified native list and by-ID records', async () => {
    await expect(
      quickbooksReadPurchasingTransactionsTool.transformResponse!(
        Response.json({
          QueryResponse: {
            Bill: [{ Id: '12', SyncToken: '1', Balance: 25 }],
            startPosition: 3,
            maxResults: 1,
          },
          time: 'test-time',
        }),
        listParams
      )
    ).resolves.toMatchObject({
      output: {
        transactionType: 'bill',
        items: [{ Id: '12', SyncToken: '1', Balance: 25 }],
        nextStartPosition: 4,
        hasMore: false,
      },
    })

    await expect(
      quickbooksReadPurchasingTransactionsTool.transformResponse!(
        Response.json({ Bill: { Id: 'A/B', SyncToken: '2' }, time: 'test-time' }),
        { ...listParams, readMode: 'by_id', transactionId: 'A/B' }
      )
    ).resolves.toMatchObject({
      output: { transactionType: 'bill', item: { Id: 'A/B', SyncToken: '2' } },
    })
  })

  it('rejects unsupported types, modes, IDs, and malformed wrappers', async () => {
    const requestUrl = quickbooksReadPurchasingTransactionsTool.request.url as (
      params: QuickBooksReadPurchasingTransactionsParams
    ) => string
    expect(() => requestUrl({ ...listParams, readMode: 'by_id' })).toThrow('transaction ID')
    expect(() =>
      requestUrl({
        ...listParams,
        transactionType:
          'unsupported' as QuickBooksReadPurchasingTransactionsParams['transactionType'],
      })
    ).toThrow('transaction type')
    expect(() =>
      requestUrl({
        ...listParams,
        readMode: 'unsupported' as QuickBooksReadPurchasingTransactionsParams['readMode'],
      })
    ).toThrow('read mode')
    await expect(
      quickbooksReadPurchasingTransactionsTool.transformResponse!(
        Response.json({ QueryResponse: { Bill: [null] } }),
        listParams
      )
    ).rejects.toThrow('malformed Bill record')
  })
})

describe('QuickBooks purchasing line and allocation validation', () => {
  it('parses bounded account and item lines and builds verified detail shapes', () => {
    expect(parseQuickBooksPurchasingLines(JSON.stringify([accountLine, itemLine]))).toEqual([
      accountLine,
      itemLine,
    ])
    expect(
      buildQuickBooksCreateBillBody({
        ...authParams,
        vendorId: '30',
        lines: [accountLine, itemLine],
        apAccountId: '33',
      })
    ).toMatchObject({
      VendorRef: { value: '30' },
      APAccountRef: { value: '33' },
      Line: [
        {
          Amount: 125,
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: { AccountRef: { value: '7' } },
        },
        {
          Amount: 60,
          DetailType: 'ItemBasedExpenseLineDetail',
          ItemBasedExpenseLineDetail: { ItemRef: { value: '21' }, Qty: 3, UnitPrice: 20 },
        },
      ],
    })
  })

  it('rejects malformed, unknown, non-positive, inconsistent, and oversized lines', () => {
    expect(() => parseQuickBooksPurchasingLines('[]')).toThrow('at least one line')
    expect(() =>
      parseQuickBooksPurchasingLines(
        '[{"lineType":"account","amount":1,"accountId":"7","raw":true}]'
      )
    ).toThrow('unsupported field')
    expect(() =>
      parseQuickBooksPurchasingLines('[{"lineType":"account","amount":0,"accountId":"7"}]')
    ).toThrow('positive finite')
    expect(() =>
      parseQuickBooksPurchasingLines(
        '[{"lineType":"item","amount":10,"itemId":"21","quantity":2,"unitPrice":6}]'
      )
    ).toThrow('amount must equal')
    expect(
      parseQuickBooksPurchasingLines(
        '[{"lineType":"item","amount":1.01,"itemId":"21","quantity":3,"unitPrice":0.335}]'
      )
    ).toEqual([
      {
        lineType: 'item',
        amount: 1.01,
        itemId: '21',
        quantity: 3,
        unitPrice: 0.335,
      },
    ])
    expect(() =>
      parseQuickBooksPurchasingLines(Array.from({ length: 101 }, () => accountLine))
    ).toThrow('more than 100')
  })

  it('parses bounded unique Bill allocations and requires exact totals', () => {
    expect(
      parseQuickBooksBillAllocations('[{"billId":"12","amount":75},{"billId":"13","amount":25}]')
    ).toEqual([
      { billId: '12', amount: 75 },
      { billId: '13', amount: 25 },
    ])
    expect(() =>
      parseQuickBooksBillAllocations('[{"billId":"12","amount":1},{"billId":"12","amount":2}]')
    ).toThrow('duplicate Bill ID')
    expect(() => parseQuickBooksBillAllocations('[{"billId":"12","amount":1,"raw":true}]')).toThrow(
      'unsupported field'
    )
    expect(() =>
      parseQuickBooksBillAllocations(
        Array.from({ length: 101 }, (_, index) => ({ billId: String(index), amount: 1 }))
      )
    ).toThrow('more than 100')

    const params: QuickBooksCreateBillPaymentParams = {
      ...authParams,
      vendorId: '30',
      totalAmount: 100,
      paymentType: 'check',
      paymentAccountId: '35',
      billAllocations: [
        { billId: '12', amount: 75 },
        { billId: '13', amount: 25 },
      ],
    }
    expect(buildQuickBooksCreateBillPaymentBody(params)).toEqual({
      VendorRef: { value: '30' },
      TotalAmt: 100,
      PayType: 'Check',
      CheckPayment: { BankAccountRef: { value: '35' } },
      Line: [
        { Amount: 75, LinkedTxn: [{ TxnId: '12', TxnType: 'Bill' }] },
        { Amount: 25, LinkedTxn: [{ TxnId: '13', TxnType: 'Bill' }] },
      ],
    })
    expect(() =>
      buildQuickBooksCreateBillPaymentBody({
        ...params,
        billAllocations: [{ billId: '12', amount: 99 }],
      })
    ).toThrow('must equal totalAmount')
  })
})

describe('QuickBooks purchasing mutation bodies', () => {
  it('builds Purchase Order, Bill, and Vendor Credit create bodies', () => {
    const purchaseOrder: QuickBooksCreatePurchaseOrderParams = {
      ...authParams,
      vendorId: '30',
      apAccountId: '33',
      lines: [accountLine],
      transactionDate: '2026-08-01',
      documentNumber: 'SANITIZED-PO',
    }
    expect(buildQuickBooksCreatePurchaseOrderBody(purchaseOrder)).toMatchObject({
      VendorRef: { value: '30' },
      APAccountRef: { value: '33' },
      TxnDate: '2026-08-01',
      DocNumber: 'SANITIZED-PO',
    })
    expect(
      buildQuickBooksCreateVendorCreditBody({
        ...authParams,
        vendorId: '30',
        lines: [accountLine],
      })
    ).toMatchObject({ VendorRef: { value: '30' } })
  })

  it('maps check and credit-card BillPayments', () => {
    const base: QuickBooksCreateBillPaymentParams = {
      ...authParams,
      vendorId: '30',
      totalAmount: 25,
      paymentType: 'check',
      paymentAccountId: '35',
      billAllocations: [{ billId: '12', amount: 25 }],
    }
    expect(buildQuickBooksCreateBillPaymentBody(base)).toMatchObject({
      PayType: 'Check',
      CheckPayment: { BankAccountRef: { value: '35' } },
    })
    expect(
      buildQuickBooksCreateBillPaymentBody({
        ...base,
        paymentType: 'credit_card',
        paymentAccountId: '41',
      })
    ).toMatchObject({
      PayType: 'CreditCard',
      CreditCardPayment: { CCAccountRef: { value: '41' } },
    })
  })

  it.each([
    ['cash', 'Cash', '35'],
    ['check', 'Check', '35'],
    ['credit_card', 'CreditCard', '41'],
  ] as const)('maps %s Purchase payment types', (paymentType, expected, paymentAccountId) => {
    const params: QuickBooksCreatePurchaseParams = {
      ...authParams,
      paymentType,
      paymentAccountId,
      vendorId: '30',
      lines: [accountLine],
      paymentReference: 'SANITIZED-REF',
    }
    expect(buildQuickBooksCreatePurchaseBody(params)).toMatchObject({
      PaymentType: expected,
      AccountRef: { value: paymentAccountId },
      EntityRef: { value: '30', type: 'Vendor' },
      PaymentRefNum: 'SANITIZED-REF',
    })
  })

  it('builds header-only sparse updates and rejects empty updates', () => {
    expect(
      buildQuickBooksUpdatePurchaseOrderBody({
        ...authParams,
        purchaseOrderId: '20',
        syncToken: '1',
        privateNote: 'Updated',
      })
    ).toEqual({ Id: '20', SyncToken: '1', sparse: true, PrivateNote: 'Updated' })
    expect(
      buildQuickBooksUpdateBillBody({
        ...authParams,
        billId: '21',
        syncToken: '2',
        vendorId: '30',
        dueDate: '2026-08-31',
      })
    ).toEqual({
      Id: '21',
      SyncToken: '2',
      sparse: true,
      VendorRef: { value: '30' },
      DueDate: '2026-08-31',
    })
    expect(
      buildQuickBooksUpdateBillPaymentBody({
        ...authParams,
        billPaymentId: '22',
        syncToken: '1',
        vendorId: '30',
        privateNote: 'Updated',
      })
    ).not.toHaveProperty('Line')
    expect(
      buildQuickBooksUpdateVendorCreditBody({
        ...authParams,
        vendorCreditId: '23',
        syncToken: '1',
        vendorId: '30',
        privateNote: 'Updated',
      })
    ).not.toHaveProperty('Line')
    expect(
      buildQuickBooksUpdatePurchaseBody({
        ...authParams,
        purchaseId: '24',
        syncToken: '1',
        currentPaymentType: 'cash',
        paymentReference: 'UPDATED',
      })
    ).toEqual({
      Id: '24',
      SyncToken: '1',
      sparse: true,
      PaymentType: 'Cash',
      PaymentRefNum: 'UPDATED',
    })
    expect(() =>
      buildQuickBooksUpdatePurchaseOrderBody({
        ...authParams,
        purchaseOrderId: '20',
        syncToken: '1',
      })
    ).toThrow('at least one field')
    expect(() =>
      buildQuickBooksUpdateBillBody({
        ...authParams,
        billId: '21',
        syncToken: '2',
        vendorId: '30',
      })
    ).toThrow('at least one field')
  })

  it.each([
    [quickbooksCreatePurchaseOrderTool, 'purchaseorder', 'PurchaseOrder'],
    [quickbooksCreateBillTool, 'bill', 'Bill'],
    [quickbooksCreateBillPaymentTool, 'billpayment', 'BillPayment'],
    [quickbooksCreateVendorCreditTool, 'vendorcredit', 'VendorCredit'],
    [quickbooksCreatePurchaseTool, 'purchase', 'Purchase'],
  ] as const)('uses one fixed %s create endpoint and wrapper', async (tool, resource, wrapper) => {
    const url = new URL(
      (tool.request.url as (params: Record<string, unknown>) => string)({
        ...authParams,
        requestId: 'request-1',
      })
    )
    expect(url.pathname).toBe(`/v3/company/123456789/${resource}`)
    expect(url.searchParams.get('requestid')).toBe('request-1')
    expect(tool.request.retry).toEqual({ enabled: false })
    expect(tool.postProcess).toBeUndefined()
    await expect(
      tool.transformResponse!(
        Response.json({ [wrapper]: { Id: '12', SyncToken: '0' }, time: 'test-time' })
      )
    ).resolves.toMatchObject({ output: { recordId: '12', syncToken: '0' } })
  })

  it.each([
    [quickbooksUpdatePurchaseOrderTool, 'purchaseorder'],
    [quickbooksUpdateBillTool, 'bill'],
    [quickbooksUpdateBillPaymentTool, 'billpayment'],
    [quickbooksUpdateVendorCreditTool, 'vendorcredit'],
    [quickbooksUpdatePurchaseTool, 'purchase'],
  ] as const)('uses one fixed %s update endpoint', (tool, resource) => {
    expect(
      new URL((tool.request.url as (params: Record<string, unknown>) => string)(authParams))
        .pathname
    ).toBe(`/v3/company/123456789/${resource}`)
    expect(tool.request.retry).toEqual({ enabled: false })
  })
})

describe('QuickBooks purchasing block', () => {
  it('parses dynamic purchasing JSON and numeric values in block parameter mapping', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_bill_payment',
        oauthCredential: 'credential-id',
        vendorId: '30',
        totalAmount: '100.50',
        billPaymentType: 'check',
        paymentAccountId: '35',
        billAllocations: '[{"billId":"12","amount":100.5}]',
      })
    ).toMatchObject({
      credential: 'credential-id',
      totalAmount: 100.5,
      paymentType: 'check',
      billAllocations: [{ billId: '12', amount: 100.5 }],
    })
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_purchase',
        oauthCredential: 'credential-id',
        purchasePaymentType: 'cash',
        paymentAccountId: '35',
        purchasingLines: JSON.stringify([accountLine]),
      })
    ).toMatchObject({ paymentType: 'cash', lines: [accountLine] })
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_update_purchase',
        oauthCredential: 'credential-id',
        transactionId: '24',
        syncToken: '1',
        currentPurchasePaymentType: 'check',
        privateNote: 'Updated',
      })
    ).toMatchObject({ currentPaymentType: 'check', privateNote: 'Updated' })
  })

  it('exposes exactly 34 operations with tool/access parity and no old list tools', () => {
    const operation = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const operationIds = (operation?.options ?? []).map((option) => option.id)
    expect(operationIds).toHaveLength(34)
    expect(new Set(operationIds).size).toBe(34)
    expect(operationIds).toEqual(QuickBooksBlock.tools.access)
    expect(operationIds).not.toContain('quickbooks_list_bills')
    expect(operationIds).not.toContain('quickbooks_list_purchase_orders')
    expect(operationIds).toContain('quickbooks_read_purchasing_transactions')
  })

  it('requires the existing Purchase payment type without fabricating a default', () => {
    const currentPaymentType = QuickBooksBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'currentPurchasePaymentType'
    )

    expect(currentPaymentType?.required).toEqual({
      field: 'operation',
      value: 'quickbooks_update_purchase',
    })
    expect(currentPaymentType?.value).toBeUndefined()
  })

  it('keeps every subblock ID unique and purchasing updates header-only', () => {
    const ids = QuickBooksBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
    const update = QuickBooksBlock.tools.config!.params!({
      operation: 'quickbooks_update_bill_payment',
      oauthCredential: 'credential-id',
      transactionId: '22',
      syncToken: '1',
      vendorId: '30',
      privateNote: 'Updated',
      billAllocations: '[{"billId":"12","amount":1}]',
      paymentAccountId: 'stale-account',
      billPaymentType: 'credit_card',
    })
    expect(update).toMatchObject({
      billPaymentId: '22',
      syncToken: '1',
      vendorId: '30',
      privateNote: 'Updated',
    })
    expect(update).toMatchObject({
      billAllocations: undefined,
      paymentAccountId: undefined,
      paymentType: undefined,
    })
  })
})
