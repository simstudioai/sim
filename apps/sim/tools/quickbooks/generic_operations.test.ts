import { describe, expect, it, vi } from 'vitest'
import { quickBooksBatchTool } from '@/tools/quickbooks/batch'
import { quickBooksCreateRecordTool } from '@/tools/quickbooks/create_record'
import { quickBooksDeleteRecordTool } from '@/tools/quickbooks/delete_record'
import { quickBooksDownloadDocumentTool } from '@/tools/quickbooks/download_document'
import { quickBooksGetAttachmentUrlTool } from '@/tools/quickbooks/get_attachment_url'
import { quickBooksGetChangesTool } from '@/tools/quickbooks/get_changes'
import { quickBooksGetExchangeRateTool } from '@/tools/quickbooks/get_exchange_rate'
import { quickBooksGetPreferencesTool } from '@/tools/quickbooks/get_preferences'
import { quickBooksGetRecordTool } from '@/tools/quickbooks/get_record'
import { quickBooksListRecordsTool } from '@/tools/quickbooks/list_records'
import { quickBooksRunReportTool } from '@/tools/quickbooks/run_report'
import { quickBooksSendDocumentTool } from '@/tools/quickbooks/send_document'
import { quickBooksUpdateExchangeRateTool } from '@/tools/quickbooks/update_exchange_rate'
import { quickBooksUpdatePreferencesTool } from '@/tools/quickbooks/update_preferences'
import { quickBooksUpdateRecordTool } from '@/tools/quickbooks/update_record'
import {
  buildQuickBooksAttachmentUrl,
  buildQuickBooksBatchBody,
  buildQuickBooksCdcUrl,
  buildQuickBooksDocumentUrl,
  buildQuickBooksExchangeRateUrl,
  buildQuickBooksHeaders,
  buildQuickBooksListRecordsQuery,
  buildQuickBooksPreferencesUrl,
  buildQuickBooksRecordUrl,
  buildQuickBooksReportUrl,
  buildQuickBooksSendDocumentUrl,
  parseQuickBooksJson,
  quickBooksCdcMayBeTruncated,
} from '@/tools/quickbooks/utils'

describe('QuickBooks generic operations', () => {
  it('builds generic list queries for documented QuickBooks entities', () => {
    expect(
      buildQuickBooksListRecordsQuery({
        entity: 'VendorCredit',
        whereClause: "TxnDate >= '2026-01-01'",
        orderBy: 'TxnDate DESC',
        startPosition: '11',
        maxResults: '10',
      })
    ).toEqual({
      entity: 'VendorCredit',
      query:
        "SELECT * FROM VendorCredit WHERE TxnDate >= '2026-01-01' ORDERBY TxnDate DESC STARTPOSITION 11 MAXRESULTS 10",
    })
  })

  it('builds entity read and delete URLs using QuickBooks resource names', () => {
    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'PurchaseOrder',
        operation: 'read',
        recordId: 'po/42',
      })
    ).toEqual({
      entity: 'PurchaseOrder',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/purchaseorder/po%2F42?minorversion=75',
    })

    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'BillPayment',
        operation: 'delete',
      })
    ).toEqual({
      entity: 'BillPayment',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/billpayment?minorversion=75&operation=delete',
    })
  })

  it('rejects unsupported entity and operation combinations', () => {
    expect(() =>
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'Vendor',
        operation: 'delete',
      })
    ).toThrow('QuickBooks entity "Vendor" cannot be deleted')

    expect(() =>
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'TaxPayment',
        operation: 'create',
      })
    ).toThrow('QuickBooks entity "TaxPayment" cannot be created')

    expect(() =>
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'RecurringTransaction',
        operation: 'update',
      })
    ).toThrow('QuickBooks entity "RecurringTransaction" cannot be updated')

    expect(() =>
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'JournalCode',
        operation: 'delete',
      })
    ).toThrow('QuickBooks entity "JournalCode" cannot be deleted')
  })

  it('builds current locale and SKU-dependent entity endpoints', () => {
    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'CreditCardPayment',
        operation: 'read',
        recordId: '41',
      }).url
    ).toBe(
      'https://quickbooks.api.intuit.com/v3/company/123145/creditcardpayment/41?minorversion=75'
    )
    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'TaxPayment',
        operation: 'read',
        recordId: '42',
      }).url
    ).toBe('https://quickbooks.api.intuit.com/v3/company/123145/taxpayment/42?minorversion=75')
    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'RecurringTransaction',
        operation: 'create',
      }).url
    ).toBe(
      'https://quickbooks.api.intuit.com/v3/company/123145/recurringtransaction?minorversion=75'
    )
    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'JournalCode',
        operation: 'update',
      }).url
    ).toBe('https://quickbooks.api.intuit.com/v3/company/123145/journalcode?minorversion=75')
  })

  it('rejects invalid access tokens before constructing QuickBooks headers', () => {
    expect(() => buildQuickBooksHeaders('')).toThrow('QuickBooks access token is required')
    expect(() => buildQuickBooksHeaders(`token\r\nX-Injected: true`)).toThrow(
      'QuickBooks access token contains invalid characters'
    )
    expect(() => buildQuickBooksHeaders('x'.repeat(4097))).toThrow(
      'QuickBooks access token must be 4096 characters or less'
    )
  })

  it('normalizes create, update, and delete request payloads', () => {
    const createBody = quickBooksCreateRecordTool.request.body
    const updateBody = quickBooksUpdateRecordTool.request.body
    const deleteBody = quickBooksDeleteRecordTool.request.body
    if (!createBody || !updateBody || !deleteBody) {
      throw new Error('Expected QuickBooks record request bodies')
    }

    expect(
      createBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'Vendor',
        payload: '{"DisplayName":"Acme Supplies"}',
      })
    ).toEqual({ DisplayName: 'Acme Supplies' })

    expect(
      updateBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'Vendor',
        recordId: '42',
        syncToken: '3',
        payload: { DisplayName: 'Acme Industrial' },
      })
    ).toEqual({
      DisplayName: 'Acme Industrial',
      Id: '42',
      SyncToken: '3',
      sparse: true,
    })

    expect(
      updateBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'InventoryAdjustment',
        recordId: '43',
        syncToken: '4',
        payload: { Line: [{ Id: '1' }] },
        sparse: false,
      })
    ).toEqual({
      Line: [{ Id: '1' }],
      Id: '43',
      SyncToken: '4',
      sparse: true,
    })

    expect(
      deleteBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'Bill',
        recordId: '17',
        syncToken: '2',
      })
    ).toEqual({ Id: '17', SyncToken: '2' })

    expect(
      deleteBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'InventoryAdjustment',
        recordId: '18',
        syncToken: '4',
        payload: {
          Id: '18',
          SyncToken: '4',
          AdjustmentAccountRef: { value: '91' },
          Line: [{ DetailType: 'ItemAdjustmentLineDetail' }],
        },
      })
    ).toEqual({
      Id: '18',
      SyncToken: '4',
      AdjustmentAccountRef: { value: '91' },
      Line: [{ DetailType: 'ItemAdjustmentLineDetail' }],
    })

    expect(
      deleteBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'Deposit',
        recordId: '19',
        syncToken: '5',
        payload: {
          Id: 'stale-id',
          SyncToken: 'stale-token',
          DepositToAccountRef: { value: '35' },
          Line: [{ Amount: 125 }],
        },
      })
    ).toEqual({
      Id: '19',
      SyncToken: '5',
      DepositToAccountRef: { value: '35' },
      Line: [{ Amount: 125 }],
    })

    expect(() =>
      deleteBody({
        accessToken: 'token',
        realmId: '123145',
        entity: 'InventoryAdjustment',
        recordId: '18',
        syncToken: '4',
      })
    ).toThrow('QuickBooks InventoryAdjustment deletion requires the full entity payload')
  })

  it('builds inventory adjustment CRUD and query requests', () => {
    expect(
      buildQuickBooksListRecordsQuery({
        entity: 'InventoryAdjustment',
        maxResults: '25',
      })
    ).toEqual({
      entity: 'InventoryAdjustment',
      query: 'SELECT * FROM InventoryAdjustment MAXRESULTS 25',
    })

    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'InventoryAdjustment',
        operation: 'create',
      })
    ).toEqual({
      entity: 'InventoryAdjustment',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/inventoryadjustment?minorversion=75',
    })

    expect(
      buildQuickBooksRecordUrl({
        realmId: '123145',
        entity: 'InventoryAdjustment',
        operation: 'read',
        recordId: '88',
      })
    ).toEqual({
      entity: 'InventoryAdjustment',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/inventoryadjustment/88?minorversion=75',
    })
  })

  it('builds report URLs with scalar query parameters', () => {
    expect(
      buildQuickBooksReportUrl({
        realmId: '123145',
        report: 'AgedPayables',
        reportParams: {
          start_date: '2026-01-01',
          end_date: '2026-01-31',
          accounting_method: 'Accrual',
        },
      })
    ).toEqual({
      report: 'AgedPayables',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/reports/AgedPayables?minorversion=75&start_date=2026-01-01&end_date=2026-01-31&accounting_method=Accrual',
    })
  })

  it('builds CDC URLs and enforces QuickBooks look-back constraints', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'))
    try {
      expect(
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'Vendor, PurchaseOrder, Bill, Budget',
          changedSince: '2026-07-15T09:00:00-08:00',
        })
      ).toBe(
        'https://quickbooks.api.intuit.com/v3/company/123145/cdc?minorversion=75&entities=Vendor%2CPurchaseOrder%2CBill%2CBudget&changedSince=2026-07-15T09%3A00%3A00-08%3A00'
      )

      expect(() =>
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'TaxRate',
          changedSince: '2026-07-15',
        })
      ).toThrow('QuickBooks entity "TaxRate" cannot be tracked by CDC')

      expect(() =>
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'JournalCode',
          changedSince: '2026-07-15',
        })
      ).toThrow('QuickBooks entity "JournalCode" cannot be tracked by CDC')

      expect(
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'CreditCardPayment,TaxPayment,RecurringTransaction',
          changedSince: '2026-07-15',
        })
      ).toContain('entities=CreditCardPayment%2CTaxPayment%2CRecurringTransaction')

      expect(() =>
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'Vendor',
          changedSince: '2026-06-01',
        })
      ).toThrow('Changed since must be within the last 30 days')

      expect(() =>
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'Vendor',
          changedSince: '2026-07-30',
        })
      ).toThrow('Changed since cannot be in the future')

      expect(() =>
        buildQuickBooksCdcUrl({
          realmId: '123145',
          entities: 'Vendor',
          changedSince: 'July 15, 2026',
        })
      ).toThrow('Changed since must be an ISO date or date-time')
    } finally {
      vi.useRealTimers()
    }
  })

  it('detects when a CDC response may have reached the 1,000-object limit', () => {
    expect(
      quickBooksCdcMayBeTruncated([
        {
          entity: 'Vendor',
          records: Array.from({ length: 1000 }, (_, index) => ({ Id: String(index + 1) })),
        },
      ])
    ).toBe(true)

    expect(
      quickBooksCdcMayBeTruncated([
        {
          entity: 'Vendor',
          records: Array.from({ length: 999 }, (_, index) => ({ Id: String(index + 1) })),
        },
      ])
    ).toBe(false)
  })

  it('builds preferences, currency, PDF, and attachment endpoint URLs', () => {
    expect(buildQuickBooksPreferencesUrl({ realmId: '123145' })).toBe(
      'https://quickbooks.api.intuit.com/v3/company/123145/preferences?minorversion=75'
    )

    expect(
      buildQuickBooksExchangeRateUrl({
        realmId: '123145',
        sourceCurrencyCode: 'eur',
        asOfDate: '2026-07-15',
      })
    ).toBe(
      'https://quickbooks.api.intuit.com/v3/company/123145/exchangerate?minorversion=75&sourcecurrencycode=EUR&asofdate=2026-07-15'
    )

    expect(
      buildQuickBooksDocumentUrl({
        realmId: '123145',
        entity: 'PurchaseOrder',
        recordId: 'po/42',
      })
    ).toEqual({
      entity: 'PurchaseOrder',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/purchaseorder/po%2F42/pdf?minorversion=75',
    })

    expect(
      buildQuickBooksAttachmentUrl({
        realmId: '123145',
        attachmentId: 'attachment/7',
        thumbnail: true,
      })
    ).toEqual({
      thumbnail: true,
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/attachable-thumbnail/attachment%2F7?minorversion=75',
    })

    expect(
      buildQuickBooksSendDocumentUrl({
        realmId: '123145',
        entity: 'PurchaseOrder',
        recordId: '42',
        sendTo: 'purchasing@example.com',
      })
    ).toEqual({
      entity: 'PurchaseOrder',
      url: 'https://quickbooks.api.intuit.com/v3/company/123145/purchaseorder/42/send?minorversion=75&sendTo=purchasing%40example.com',
    })
  })

  it('validates QuickBooks batch payload size', () => {
    expect(
      buildQuickBooksBatchBody({
        BatchItemRequest: [{ bId: 'vendor-query', Query: 'SELECT * FROM Vendor' }],
      })
    ).toEqual({
      BatchItemRequest: [{ bId: 'vendor-query', Query: 'SELECT * FROM Vendor' }],
    })

    expect(() =>
      buildQuickBooksBatchBody({
        BatchItemRequest: Array.from({ length: 11 }, (_, index) => ({ bId: String(index) })),
      })
    ).toThrow('QuickBooks batch payload must contain 10 items or less')
  })

  it('rejects QuickBooks responses larger than 10 MB before reading the body', async () => {
    const response = new Response(null, {
      headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
      status: 200,
    })

    await expect(parseQuickBooksJson(response)).rejects.toThrow(
      'QuickBooks API response exceeds maximum size of 10485760 bytes'
    )
  })

  it('transforms generic list QueryResponse arrays', async () => {
    const response = new Response(
      JSON.stringify({
        QueryResponse: {
          VendorCredit: [{ Id: '9', TotalAmt: 125 }],
          startPosition: 1,
          maxResults: 1,
        },
      }),
      { status: 200 }
    )

    const result = await quickBooksListRecordsTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      entity: 'VendorCredit',
      maxResults: '1',
    })

    expect(result?.output).toEqual({
      items: [{ Id: '9', TotalAmt: 125 }],
      entity: 'VendorCredit',
      totalCount: null,
      startPosition: 1,
      maxResults: 1,
      query: 'SELECT * FROM VendorCredit MAXRESULTS 1',
    })
  })

  it('transforms generic record envelopes', async () => {
    const response = new Response(
      JSON.stringify({
        PurchaseOrder: { Id: '42', SyncToken: '1', TotalAmt: 500 },
        time: '2026-01-20T10:00:00-08:00',
      }),
      { status: 200 }
    )

    const result = await quickBooksGetRecordTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      entity: 'PurchaseOrder',
      recordId: '42',
    })

    expect(result?.output).toEqual({
      record: { Id: '42', SyncToken: '1', TotalAmt: 500 },
      entity: 'PurchaseOrder',
      time: '2026-01-20T10:00:00-08:00',
    })
  })

  it('rejects successful record responses that omit the entity record', async () => {
    const emptyResponse = () =>
      new Response(JSON.stringify({ time: '2026-01-20T10:00:00-08:00' }), { status: 200 })

    await expect(
      quickBooksCreateRecordTool.transformResponse?.(emptyResponse(), {
        accessToken: 'token',
        realmId: '123145',
        entity: 'Vendor',
        payload: { DisplayName: 'Acme Supplies' },
      })
    ).rejects.toThrow('QuickBooks API response did not include Vendor')

    await expect(
      quickBooksGetRecordTool.transformResponse?.(emptyResponse(), {
        accessToken: 'token',
        realmId: '123145',
        entity: 'PurchaseOrder',
        recordId: '42',
      })
    ).rejects.toThrow('QuickBooks API response did not include PurchaseOrder')

    await expect(
      quickBooksUpdateRecordTool.transformResponse?.(emptyResponse(), {
        accessToken: 'token',
        realmId: '123145',
        entity: 'Vendor',
        recordId: '7',
        syncToken: '1',
        payload: { DisplayName: 'Acme Industrial' },
      })
    ).rejects.toThrow('QuickBooks API response did not include Vendor')

    await expect(
      quickBooksDeleteRecordTool.transformResponse?.(emptyResponse(), {
        accessToken: 'token',
        realmId: '123145',
        entity: 'Bill',
        recordId: '17',
        syncToken: '2',
      })
    ).rejects.toThrow('QuickBooks API response did not include Bill')

    await expect(
      quickBooksGetPreferencesTool.transformResponse?.(emptyResponse(), {
        accessToken: 'token',
        realmId: '123145',
      })
    ).rejects.toThrow('QuickBooks API response did not include Preferences')

    await expect(
      quickBooksGetExchangeRateTool.transformResponse?.(emptyResponse(), {
        accessToken: 'token',
        realmId: '123145',
        sourceCurrencyCode: 'EUR',
      })
    ).rejects.toThrow('QuickBooks API response did not include ExchangeRate')
  })

  it('transforms QuickBooks report sections', async () => {
    const response = new Response(
      JSON.stringify({
        Header: { ReportName: 'AgedPayables', ReportBasis: 'Accrual' },
        Columns: { Column: [{ ColTitle: 'Vendor' }] },
        Rows: { Row: [{ type: 'Data' }] },
        time: '2026-01-20T10:00:00-08:00',
      }),
      { status: 200 }
    )

    const result = await quickBooksRunReportTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      report: 'AgedPayables',
    })

    expect(result?.output).toEqual({
      report: 'AgedPayables',
      header: { ReportName: 'AgedPayables', ReportBasis: 'Accrual' },
      columns: { Column: [{ ColTitle: 'Vendor' }] },
      rows: { Row: [{ type: 'Data' }] },
      time: '2026-01-20T10:00:00-08:00',
    })
  })

  it('transforms QuickBooks CDC entity groups and deleted records', async () => {
    const response = new Response(
      JSON.stringify({
        CDCResponse: [
          {
            QueryResponse: [
              {
                Vendor: [
                  { Id: '1', DisplayName: 'Acme' },
                  { Id: '2', status: 'Deleted' },
                ],
                startPosition: 1,
                maxResults: 2,
                totalCount: 2,
              },
            ],
          },
        ],
        time: '2026-01-20T10:00:00-08:00',
      }),
      { status: 200 }
    )

    const result = await quickBooksGetChangesTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      entities: 'Vendor',
      changedSince: '2026-01-19',
    })

    expect(result?.output).toEqual({
      changes: [
        {
          entity: 'Vendor',
          records: [
            { Id: '1', DisplayName: 'Acme' },
            { Id: '2', status: 'Deleted' },
          ],
          startPosition: 1,
          maxResults: 2,
          totalCount: 2,
        },
      ],
      changedSince: '2026-01-19',
      mayBeTruncated: false,
      time: '2026-01-20T10:00:00-08:00',
    })
  })

  it('transforms preferences and exchange rate envelopes', async () => {
    const preferencesResponse = new Response(
      JSON.stringify({
        Preferences: { VendorAndPurchasesPrefs: { UsePurchaseOrder: true } },
        time: '2026-07-29T10:00:00-07:00',
      }),
      { status: 200 }
    )
    const exchangeRateResponse = new Response(
      JSON.stringify({
        ExchangeRate: {
          SourceCurrencyCode: 'EUR',
          TargetCurrencyCode: 'USD',
          Rate: 1.15,
          AsOfDate: '2026-07-29',
        },
        time: '2026-07-29T10:00:00-07:00',
      }),
      { status: 200 }
    )

    expect(
      (await quickBooksGetPreferencesTool.transformResponse?.(preferencesResponse))?.output
    ).toEqual({
      record: { VendorAndPurchasesPrefs: { UsePurchaseOrder: true } },
      entity: 'Preferences',
      time: '2026-07-29T10:00:00-07:00',
    })

    expect(
      (await quickBooksGetExchangeRateTool.transformResponse?.(exchangeRateResponse))?.output
    ).toEqual({
      record: {
        SourceCurrencyCode: 'EUR',
        TargetCurrencyCode: 'USD',
        Rate: 1.15,
        AsOfDate: '2026-07-29',
      },
      entity: 'ExchangeRate',
      time: '2026-07-29T10:00:00-07:00',
    })

    const preferencesBody = quickBooksUpdatePreferencesTool.request.body
    if (!preferencesBody) throw new Error('Expected QuickBooks preferences request body')
    expect(
      preferencesBody({
        accessToken: 'token',
        realmId: '123145',
        payload: { VendorAndPurchasesPrefs: { UsePurchaseOrder: true } },
      })
    ).toEqual({ VendorAndPurchasesPrefs: { UsePurchaseOrder: true } })
  })

  it('normalizes exchange-rate updates and transforms document and attachment responses', async () => {
    const exchangeRateBody = quickBooksUpdateExchangeRateTool.request.body
    if (!exchangeRateBody) throw new Error('Expected QuickBooks exchange rate request body')
    expect(
      exchangeRateBody({
        accessToken: 'token',
        realmId: '123145',
        payload: {
          SourceCurrencyCode: 'EUR',
          TargetCurrencyCode: 'USD',
          Rate: 1.15,
          AsOfDate: '2026-07-29',
          SyncToken: '0',
        },
      })
    ).toEqual({
      SourceCurrencyCode: 'EUR',
      TargetCurrencyCode: 'USD',
      Rate: 1.15,
      AsOfDate: '2026-07-29',
      SyncToken: '0',
    })

    const documentResult = await quickBooksDownloadDocumentTool.transformResponse?.(
      new Response(new Uint8Array([37, 80, 68, 70, 45]), {
        headers: { 'content-type': 'application/pdf' },
        status: 200,
      }),
      {
        accessToken: 'token',
        realmId: '123145',
        entity: 'PurchaseOrder',
        recordId: '42',
      }
    )
    expect(documentResult?.output).toEqual({
      file: {
        name: 'PurchaseOrder-42.pdf',
        mimeType: 'application/pdf',
        data: 'JVBERi0=',
        size: 5,
      },
      entity: 'PurchaseOrder',
      recordId: '42',
    })

    const sentDocumentResult = await quickBooksSendDocumentTool.transformResponse?.(
      new Response(new Uint8Array([37, 80, 68, 70, 45]), {
        headers: { 'content-type': 'application/octet-stream' },
        status: 200,
      }),
      {
        accessToken: 'token',
        realmId: '123145',
        entity: 'PurchaseOrder',
        recordId: '42',
        sendTo: 'purchasing@example.com',
      }
    )
    expect(sentDocumentResult?.output).toEqual({
      file: {
        name: 'PurchaseOrder-42.pdf',
        mimeType: 'application/pdf',
        data: 'JVBERi0=',
        size: 5,
      },
      entity: 'PurchaseOrder',
      recordId: '42',
    })

    const attachmentResult = await quickBooksGetAttachmentUrlTool.transformResponse?.(
      new Response('https://files.example.com/temporary-file', { status: 200 }),
      {
        accessToken: 'token',
        realmId: '123145',
        attachmentId: '7',
        thumbnail: false,
      }
    )
    expect(attachmentResult?.output).toEqual({
      url: 'https://files.example.com/temporary-file',
      attachmentId: '7',
      thumbnail: false,
    })
  })

  it('rejects successful document responses that are not PDFs', async () => {
    const params = {
      accessToken: 'token',
      realmId: '123145',
      entity: 'PurchaseOrder' as const,
      recordId: '42',
    }

    await expect(
      quickBooksDownloadDocumentTool.transformResponse?.(
        new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Unexpected response' }] } }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
        params
      )
    ).rejects.toThrow('QuickBooks PDF download returned a non-PDF response (application/json)')

    await expect(
      quickBooksSendDocumentTool.transformResponse?.(
        new Response('', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        }),
        params
      )
    ).rejects.toThrow(
      'QuickBooks sent document returned a non-PDF response (text/plain): Empty response'
    )
  })

  it('transforms QuickBooks batch item responses without hiding item faults', async () => {
    const response = new Response(
      JSON.stringify({
        BatchItemResponse: [
          { bId: 'vendor-query', QueryResponse: { Vendor: [{ Id: '1' }] } },
          { bId: 'bad-update', Fault: { Error: [{ code: '5010' }] } },
        ],
        time: '2026-01-20T10:00:00-08:00',
      }),
      { status: 200 }
    )

    const result = await quickBooksBatchTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      batch: { BatchItemRequest: [] },
    })

    expect(result?.output).toEqual({
      batchItems: [
        { bId: 'vendor-query', QueryResponse: { Vendor: [{ Id: '1' }] } },
        { bId: 'bad-update', Fault: { Error: [{ code: '5010' }] } },
      ],
      time: '2026-01-20T10:00:00-08:00',
    })
  })
})
