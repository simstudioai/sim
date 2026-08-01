import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import {
  quickbooksCreateCreditMemoTool,
  quickbooksCreateCustomerPaymentTool,
  quickbooksCreateEstimateTool,
  quickbooksCreateInvoiceTool,
  quickbooksCreateRefundReceiptTool,
  quickbooksCreateSalesReceiptTool,
  quickbooksReadSalesTransactionsTool,
  quickbooksUpdateCreditMemoTool,
  quickbooksUpdateCustomerPaymentTool,
  quickbooksUpdateEstimateTool,
  quickbooksUpdateInvoiceTool,
  quickbooksUpdateRefundReceiptTool,
  quickbooksUpdateSalesReceiptTool,
  quickbooksVoidCustomerPaymentTool,
  quickbooksVoidInvoiceTool,
} from '@/tools/quickbooks'
import {
  buildQuickBooksCreatePaymentBody,
  buildQuickBooksCreateSalesDocumentBody,
  buildQuickBooksUpdatePaymentBody,
  buildQuickBooksUpdateSalesDocumentBody,
  parseQuickBooksInvoiceAllocations,
  parseQuickBooksSalesLines,
} from '@/tools/quickbooks/sales_utils'
import type {
  QuickBooksCreateCustomerPaymentParams,
  QuickBooksCreateSalesDocumentParams,
  QuickBooksReadSalesTransactionsParams,
  QuickBooksUpdateCustomerPaymentParams,
  QuickBooksUpdateSalesDocumentParams,
  QuickBooksVoidTransactionParams,
} from '@/tools/quickbooks/types'

const authParams = { accessToken: 'access-token', realmId: '123456789' }

const itemLine = {
  lineType: 'item' as const,
  amount: 125.5,
  itemId: '7',
  description: 'Sanitized consulting',
  quantity: 2,
  unitPrice: 62.75,
  serviceDate: '2026-07-31',
}

beforeEach(() => setEnv({ QUICKBOOKS_ENV: 'sandbox' }))
afterEach(resetEnvMock)

describe('QuickBooks sales reader', () => {
  const listParams: QuickBooksReadSalesTransactionsParams = {
    ...authParams,
    transactionType: 'invoice',
    readMode: 'list',
    startPosition: 3,
    maxResults: 25,
  }

  it.each([
    ['estimate', 'Estimate', 'estimate'],
    ['invoice', 'Invoice', 'invoice'],
    ['sales_receipt', 'SalesReceipt', 'salesreceipt'],
    ['payment', 'Payment', 'payment'],
    ['credit_memo', 'CreditMemo', 'creditmemo'],
    ['refund_receipt', 'RefundReceipt', 'refundreceipt'],
  ] as const)('maps %s to fixed list and by-ID contracts', (transactionType, entity, resource) => {
    const requestUrl = quickbooksReadSalesTransactionsTool.request.url as (
      params: QuickBooksReadSalesTransactionsParams
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

  it('preserves native list and by-ID records', async () => {
    await expect(
      quickbooksReadSalesTransactionsTool.transformResponse!(
        Response.json({
          QueryResponse: {
            Invoice: [{ Id: '12', SyncToken: '1', DocNumber: 'SANITIZED-12' }],
            startPosition: 3,
            maxResults: 1,
          },
          time: 'test-time',
        }),
        listParams
      )
    ).resolves.toEqual({
      success: true,
      output: {
        transactionType: 'invoice',
        items: [{ Id: '12', SyncToken: '1', DocNumber: 'SANITIZED-12' }],
        startPosition: 3,
        maxResults: 1,
        nextStartPosition: 4,
        hasMore: false,
        time: 'test-time',
      },
    })

    await expect(
      quickbooksReadSalesTransactionsTool.transformResponse!(
        Response.json({ Invoice: { Id: 'A/B', SyncToken: '2' }, time: 'test-time' }),
        { ...listParams, readMode: 'by_id', transactionId: 'A/B' }
      )
    ).resolves.toEqual({
      success: true,
      output: {
        transactionType: 'invoice',
        item: { Id: 'A/B', SyncToken: '2' },
        time: 'test-time',
      },
    })
  })

  it('marks mode-specific sales read outputs as optional', () => {
    expect(quickbooksReadSalesTransactionsTool.outputs.item?.optional).toBe(true)
    expect(quickbooksReadSalesTransactionsTool.outputs.items?.optional).toBe(true)
    for (const output of ['startPosition', 'maxResults', 'nextStartPosition', 'hasMore']) {
      expect(quickbooksReadSalesTransactionsTool.outputs[output]?.optional).toBe(true)
    }
  })

  it('rejects malformed records without usable QuickBooks IDs', async () => {
    await expect(
      quickbooksReadSalesTransactionsTool.transformResponse!(
        Response.json({ QueryResponse: { Invoice: [null] } }),
        listParams
      )
    ).rejects.toThrow('malformed Invoice record')

    await expect(
      quickbooksReadSalesTransactionsTool.transformResponse!(Response.json({ Invoice: {} }), {
        ...listParams,
        readMode: 'by_id',
        transactionId: '12',
      })
    ).rejects.toThrow('without an Id')
  })

  it('rejects unknown types, modes, and missing by-ID values before a request', () => {
    const requestUrl = quickbooksReadSalesTransactionsTool.request.url as (
      params: QuickBooksReadSalesTransactionsParams
    ) => string
    expect(() => requestUrl({ ...listParams, readMode: 'by_id' })).toThrow('transaction ID')
    expect(() =>
      requestUrl({
        ...listParams,
        transactionType: 'unsupported' as QuickBooksReadSalesTransactionsParams['transactionType'],
      })
    ).toThrow('transaction type')
    expect(() =>
      requestUrl({
        ...listParams,
        readMode: 'unsupported' as QuickBooksReadSalesTransactionsParams['readMode'],
      })
    ).toThrow('read mode')
  })
})

describe('QuickBooks sales document validation and bodies', () => {
  it('parses item and description lines and rejects unbounded or unknown input', () => {
    expect(
      parseQuickBooksSalesLines(
        JSON.stringify([itemLine, { lineType: 'description', description: 'Sanitized note' }])
      )
    ).toEqual([itemLine, { lineType: 'description', description: 'Sanitized note' }])
    expect(() => parseQuickBooksSalesLines('[]')).toThrow('at least one line')
    expect(() =>
      parseQuickBooksSalesLines('[{"lineType":"item","amount":1,"itemId":"7","raw":true}]')
    ).toThrow('unsupported field')
    expect(() =>
      parseQuickBooksSalesLines('[{"lineType":"item","amount":0,"itemId":"7"}]')
    ).toThrow('positive finite')
    expect(() => parseQuickBooksSalesLines('[{"lineType":"item","amount":1,"itemId":7}]')).toThrow(
      'itemId must be a string'
    )
    expect(() =>
      parseQuickBooksSalesLines('[{"lineType":"item","amount":10,"itemId":"7","quantity":0}]')
    ).toThrow('quantity must be a positive finite number')
    expect(() =>
      parseQuickBooksSalesLines('[{"lineType":"item","amount":10,"itemId":"7","unitPrice":-1}]')
    ).toThrow('unitPrice must be a positive finite number')
    expect(() =>
      parseQuickBooksSalesLines(
        '[{"lineType":"item","amount":10,"itemId":"7","quantity":2,"unitPrice":6}]'
      )
    ).toThrow('amount must equal quantity multiplied by unitPrice')
    expect(
      parseQuickBooksSalesLines(
        '[{"lineType":"item","amount":0.02,"itemId":"7","quantity":0.1,"unitPrice":0.2}]'
      )
    ).toEqual([
      {
        lineType: 'item',
        amount: 0.02,
        itemId: '7',
        description: undefined,
        quantity: 0.1,
        unitPrice: 0.2,
        serviceDate: undefined,
      },
    ])
    expect(() =>
      parseQuickBooksSalesLines(
        '[{"lineType":"item","amount":1,"itemId":"7","serviceDate":"2026-02-30"}]'
      )
    ).toThrow('valid date')
    expect(() => parseQuickBooksSalesLines(Array.from({ length: 101 }, () => itemLine))).toThrow(
      'more than 100'
    )
  })

  it('builds the bounded common create body without raw fragments', () => {
    const params: QuickBooksCreateSalesDocumentParams = {
      ...authParams,
      customerId: ' 2 ',
      lines: [itemLine, { lineType: 'description', description: 'Sanitized note' }],
      transactionDate: '2026-07-31',
      documentNumber: 'SANITIZED-1',
      privateNote: 'Internal note',
      customerMemo: 'Customer memo',
      dueDate: '2026-08-31',
      expirationDate: '2026-08-15',
      paymentMethodId: '3',
      paymentReferenceNumber: 'CHECK-1',
      depositAccountId: '4',
    }
    expect(buildQuickBooksCreateSalesDocumentBody(params)).toEqual({
      CustomerRef: { value: '2' },
      Line: [
        {
          Amount: 125.5,
          Description: 'Sanitized consulting',
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            ItemRef: { value: '7' },
            Qty: 2,
            UnitPrice: 62.75,
            ServiceDate: '2026-07-31',
          },
        },
        { DetailType: 'DescriptionOnly', Description: 'Sanitized note' },
      ],
      TxnDate: '2026-07-31',
      DocNumber: 'SANITIZED-1',
      PrivateNote: 'Internal note',
      CustomerMemo: { value: 'Customer memo' },
      DueDate: '2026-08-31',
      ExpirationDate: '2026-08-15',
      PaymentMethodRef: { value: '3' },
      PaymentRefNum: 'CHECK-1',
      DepositToAccountRef: { value: '4' },
    })
  })

  it('requires a deposit account for refund-receipt creation', () => {
    expect(() =>
      buildQuickBooksCreateSalesDocumentBody(
        { ...authParams, customerId: '2', lines: [itemLine] },
        { requireDepositAccount: true }
      )
    ).toThrow('depositAccountId')
  })

  it('builds sparse updates and rejects an empty update', () => {
    const params: QuickBooksUpdateSalesDocumentParams = {
      ...authParams,
      transactionId: '12',
      syncToken: '3',
      privateNote: 'Replacement note',
    }
    expect(buildQuickBooksUpdateSalesDocumentBody(params)).toEqual({
      Id: '12',
      SyncToken: '3',
      sparse: true,
      PrivateNote: 'Replacement note',
    })
    expect(() =>
      buildQuickBooksUpdateSalesDocumentBody({
        ...authParams,
        transactionId: '12',
        syncToken: '3',
      })
    ).toThrow('at least one field')
  })

  it.each([
    [quickbooksCreateEstimateTool, 'estimate', 'Estimate'],
    [quickbooksCreateInvoiceTool, 'invoice', 'Invoice'],
    [quickbooksCreateSalesReceiptTool, 'salesreceipt', 'SalesReceipt'],
    [quickbooksCreateCreditMemoTool, 'creditmemo', 'CreditMemo'],
    [quickbooksCreateRefundReceiptTool, 'refundreceipt', 'RefundReceipt'],
  ] as const)(
    'uses one fixed %s create endpoint and verified wrapper',
    async (tool, resource, wrapper) => {
      const requestUrl = tool.request.url as (params: QuickBooksCreateSalesDocumentParams) => string
      const url = new URL(
        requestUrl({ ...authParams, customerId: '2', lines: [itemLine], requestId: 'request-1' })
      )
      expect(url.pathname).toBe(`/v3/company/123456789/${resource}`)
      expect(url.searchParams.get('requestid')).toBe('request-1')
      expect(tool.postProcess).toBeUndefined()
      await expect(
        tool.transformResponse!(
          Response.json({ [wrapper]: { Id: '12', SyncToken: '0' }, time: 'test-time' })
        )
      ).resolves.toMatchObject({
        success: true,
        output: { recordId: '12', syncToken: '0', time: 'test-time' },
      })
    }
  )

  it.each([
    [quickbooksUpdateEstimateTool, 'estimate'],
    [quickbooksUpdateInvoiceTool, 'invoice'],
    [quickbooksUpdateSalesReceiptTool, 'salesreceipt'],
    [quickbooksUpdateCreditMemoTool, 'creditmemo'],
    [quickbooksUpdateRefundReceiptTool, 'refundreceipt'],
  ] as const)('uses one fixed %s sparse-update endpoint', (tool, resource) => {
    const requestUrl = tool.request.url as (params: QuickBooksUpdateSalesDocumentParams) => string
    expect(
      new URL(
        requestUrl({
          ...authParams,
          transactionId: '12',
          syncToken: '1',
          privateNote: 'Replacement',
        })
      ).pathname
    ).toBe(`/v3/company/123456789/${resource}`)
    expect(tool.postProcess).toBeUndefined()
  })
})

describe('QuickBooks customer payments and voids', () => {
  it('parses bounded allocations and enforces payment totals', () => {
    expect(parseQuickBooksInvoiceAllocations('[{"invoiceId":"12","amount":75}]')).toEqual([
      { invoiceId: '12', amount: 75 },
    ])
    expect(() =>
      parseQuickBooksInvoiceAllocations('[{"invoiceId":"12","amount":75,"raw":true}]')
    ).toThrow('unsupported field')
    expect(() => parseQuickBooksInvoiceAllocations('[{"invoiceId":12,"amount":75}]')).toThrow(
      'invoiceId must be a string'
    )

    const params: QuickBooksCreateCustomerPaymentParams = {
      ...authParams,
      customerId: '2',
      totalAmount: 100,
      invoiceAllocations: [{ invoiceId: '12', amount: 75 }],
    }
    expect(buildQuickBooksCreatePaymentBody(params)).toEqual({
      CustomerRef: { value: '2' },
      TotalAmt: 100,
      Line: [{ Amount: 75, LinkedTxn: [{ TxnId: '12', TxnType: 'Invoice' }] }],
    })
    expect(() =>
      buildQuickBooksCreatePaymentBody({
        ...params,
        invoiceAllocations: [{ invoiceId: '12', amount: 101 }],
      })
    ).toThrow('cannot exceed')

    expect(
      buildQuickBooksCreatePaymentBody({
        ...params,
        totalAmount: 0.06,
        invoiceAllocations: [
          { invoiceId: '12', amount: 0.01 },
          { invoiceId: '13', amount: 0.05 },
        ],
      })
    ).toMatchObject({ TotalAmt: 0.06 })
  })

  it('builds sparse payment updates and rejects allocations without a replacement total', () => {
    const params: QuickBooksUpdateCustomerPaymentParams = {
      ...authParams,
      paymentId: '15',
      syncToken: '2',
      totalAmount: 50,
      invoiceAllocations: [{ invoiceId: '12', amount: 25 }],
    }
    expect(buildQuickBooksUpdatePaymentBody(params)).toEqual({
      Id: '15',
      SyncToken: '2',
      sparse: true,
      TotalAmt: 50,
      Line: [{ Amount: 25, LinkedTxn: [{ TxnId: '12', TxnType: 'Invoice' }] }],
    })
    expect(() =>
      buildQuickBooksUpdatePaymentBody({
        ...authParams,
        paymentId: '15',
        syncToken: '2',
        invoiceAllocations: [{ invoiceId: '12', amount: 25 }],
      })
    ).toThrow('totalAmount is required')

    expect(
      buildQuickBooksUpdatePaymentBody({
        ...authParams,
        paymentId: '15',
        syncToken: '2',
        totalAmount: 0.06,
        invoiceAllocations: [
          { invoiceId: '12', amount: 0.01 },
          { invoiceId: '13', amount: 0.05 },
        ],
      })
    ).toMatchObject({ TotalAmt: 0.06 })
  })

  it('uses the verified payment endpoints', () => {
    const createUrl = quickbooksCreateCustomerPaymentTool.request.url as (
      params: QuickBooksCreateCustomerPaymentParams
    ) => string
    expect(
      new URL(
        createUrl({ ...authParams, customerId: '2', totalAmount: 10, requestId: 'payment-1' })
      ).searchParams.get('requestid')
    ).toBe('payment-1')
    expect(
      new URL(
        (
          quickbooksUpdateCustomerPaymentTool.request.url as (
            params: QuickBooksUpdateCustomerPaymentParams
          ) => string
        )({ ...authParams, paymentId: '15', syncToken: '2', privateNote: 'Updated' })
      ).pathname
    ).toBe('/v3/company/123456789/payment')
  })

  it.each([
    [quickbooksVoidInvoiceTool, 'invoice', 'void', null],
    [quickbooksVoidCustomerPaymentTool, 'payment', 'update', 'void'],
  ] as const)(
    'requires confirmation and uses the verified %s void contract',
    (tool, resource, operation, include) => {
      const params: QuickBooksVoidTransactionParams = {
        ...authParams,
        transactionId: '20',
        syncToken: '3',
        confirmVoid: true,
      }
      const url = new URL(
        (tool.request.url as (value: QuickBooksVoidTransactionParams) => string)(params)
      )
      expect(url.pathname).toBe(`/v3/company/123456789/${resource}`)
      expect(url.searchParams.get('operation')).toBe(operation)
      expect(url.searchParams.get('include')).toBe(include)
      expect(tool.request.body!(params)).toMatchObject({ Id: '20', SyncToken: '3' })
      expect(() => tool.request.body!({ ...params, confirmVoid: false })).toThrow('Confirm void')
    }
  )
})

describe('QuickBooks sales block coercion', () => {
  it('does not force array-valued wand prompts through JSON-object generation', () => {
    for (const id of ['lines', 'invoiceAllocations']) {
      const subBlock = QuickBooksBlock.subBlocks.find((candidate) => candidate.id === id)
      expect(subBlock?.wandConfig?.enabled).toBe(true)
      expect(subBlock?.wandConfig?.generationType).toBeUndefined()
    }
  })

  it('parses dynamic JSON and numeric values only in block parameter mapping', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_invoice',
        oauthCredential: 'credential-id',
        customerId: '2',
        lines: JSON.stringify([itemLine]),
        requestId: 'request-1',
      })
    ).toMatchObject({ credential: 'credential-id', customerId: '2', lines: [itemLine] })

    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_customer_payment',
        oauthCredential: 'credential-id',
        customerId: '2',
        totalAmount: '100.50',
        invoiceAllocations: '[{"invoiceId":"12","amount":75}]',
      })
    ).toMatchObject({
      credential: 'credential-id',
      totalAmount: 100.5,
      invoiceAllocations: [{ invoiceId: '12', amount: 75 }],
    })
  })

  it('drops stale hidden fields when the selected sales operation changes', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_estimate',
        oauthCredential: 'credential-id',
        customerId: '2',
        lines: JSON.stringify([itemLine]),
        dueDate: '2026-08-31',
        paymentMethodId: 'stale-payment-method',
        depositAccountId: 'stale-deposit-account',
        transactionId: 'stale-id',
        syncToken: 'stale-token',
      })
    ).toMatchObject({
      dueDate: undefined,
      paymentMethodId: undefined,
      depositAccountId: undefined,
      transactionId: undefined,
      syncToken: undefined,
    })

    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_update_customer_payment',
        oauthCredential: 'credential-id',
        transactionId: '20',
        syncToken: '3',
        requestId: 'stale-request-id',
      })
    ).toMatchObject({ paymentId: '20', syncToken: '3', requestId: undefined })
  })

  it('maps read and void UI values directly to bounded tool parameters', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_read_sales_transactions',
        oauthCredential: 'credential-id',
        transactionType: 'invoice',
        readMode: 'list',
        startPosition: '1',
        maxResults: '25',
      })
    ).toEqual({
      credential: 'credential-id',
      transactionType: 'invoice',
      readMode: 'list',
      startPosition: 1,
      maxResults: 25,
    })
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_void_invoice',
        oauthCredential: 'credential-id',
        transactionId: '20',
        syncToken: '3',
        confirmVoid: 'yes',
      })
    ).toEqual({
      credential: 'credential-id',
      transactionId: '20',
      syncToken: '3',
      confirmVoid: true,
    })
  })
})
