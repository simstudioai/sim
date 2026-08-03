import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import { quickbooksReadMasterDataTool } from '@/tools/quickbooks/read_master_data'
import { quickbooksRunFinancialReportTool } from '@/tools/quickbooks/run_financial_report'
import type {
  QuickBooksReadMasterDataParams,
  QuickBooksReportSummarizeBy,
  QuickBooksReportType,
  QuickBooksRunFinancialReportParams,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksReportUrl,
  getQuickBooksReportTypesSupporting,
  QUICKBOOKS_REPORTS,
} from '@/tools/quickbooks/utils'

const authParams = { accessToken: 'access-token', realmId: '123456789' }

const reportEndpoints = [
  ['ap_aging_detail', 'AgedPayableDetail'],
  ['ap_aging_summary', 'AgedPayables'],
  ['ar_aging_detail', 'AgedReceivableDetail'],
  ['ar_aging_summary', 'AgedReceivables'],
  ['balance_sheet', 'BalanceSheet'],
  ['cash_flow', 'CashFlow'],
  ['customer_balance', 'CustomerBalance'],
  ['expenses_by_vendor', 'VendorExpenses'],
  ['profit_and_loss', 'ProfitAndLoss'],
  ['profit_and_loss_detail', 'ProfitAndLossDetail'],
  ['sales_by_customer', 'CustomerSales'],
  ['sales_by_item', 'ItemSales'],
  ['trial_balance', 'TrialBalance'],
  ['vendor_balance', 'VendorBalance'],
] as const satisfies ReadonlyArray<readonly [QuickBooksReportType, string]>

beforeEach(() => setEnv({ QUICKBOOKS_ENV: 'sandbox' }))
afterEach(resetEnvMock)

describe('QuickBooks financial report request construction', () => {
  it.each(reportEndpoints)('maps %s to the fixed %s endpoint', (reportType, endpoint) => {
    const url = buildQuickBooksReportUrl({ ...authParams, reportType })
    expect(url.origin).toBe('https://sandbox-quickbooks.api.intuit.com')
    expect(url.pathname).toBe(`/v3/company/123456789/reports/${endpoint}`)
    expect(url.searchParams.get('minorversion')).toBe('75')
    expect([...url.searchParams.keys()]).toEqual(['minorversion'])
  })

  it('selects the production host only from QUICKBOOKS_ENV', () => {
    setEnv({ QUICKBOOKS_ENV: 'production' })
    expect(buildQuickBooksReportUrl({ ...authParams, reportType: 'balance_sheet' }).origin).toBe(
      'https://quickbooks.api.intuit.com'
    )
  })

  it('maps dates, basis, entity filters, and trims operational IDs', () => {
    const url = buildQuickBooksReportUrl({
      ...authParams,
      reportType: 'profit_and_loss',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      accountingMethod: 'cash',
      customerId: ' 42 ',
      vendorId: ' 43 ',
      accountId: ' 7 ',
      itemId: ' 21 ',
      classId: ' 5 ',
      departmentId: ' 6 ',
    })
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      accounting_method: 'Cash',
      customer: '42',
      vendor: '43',
      account: '7',
      item: '21',
      class: '5',
      department: '6',
    })
  })

  it.each([
    ['total', 'Total'],
    ['day', 'Days'],
    ['week', 'Week'],
    ['month', 'Month'],
    ['quarter', 'Quarter'],
    ['year', 'Year'],
    ['customer', 'Customers'],
    ['vendor', 'Vendors'],
    ['item', 'ProductsAndServices'],
    ['class', 'Classes'],
    ['department', 'Departments'],
  ] as const)('maps summarizeBy=%s to %s', (summarizeBy, expected) => {
    const url = buildQuickBooksReportUrl({
      ...authParams,
      reportType: 'profit_and_loss',
      summarizeBy,
    })
    expect(url.searchParams.get('summarize_column_by')).toBe(expected)
  })

  it('maps aging controls and an as-of date only for aging reports', () => {
    const url = buildQuickBooksReportUrl({
      ...authParams,
      reportType: 'ap_aging_detail',
      endDate: '2026-08-02',
      agingMethod: 'report_date',
      agingDays: 15,
      vendorId: '62',
    })
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      report_date: '2026-08-02',
      aging_method: 'Report_Date',
      aging_period: '15',
      vendor: '62',
    })
    expect(url.searchParams.has('end_date')).toBe(false)
  })

  it('omits blank and default controls', () => {
    const url = buildQuickBooksReportUrl({
      ...authParams,
      reportType: 'profit_and_loss',
      startDate: ' ',
      customerId: ' ',
      accountingMethod: 'default',
      summarizeBy: 'default',
    })
    expect([...url.searchParams.keys()]).toEqual(['minorversion'])
  })

  it.each([
    [{ reportType: 'balance_sheet', startDate: '2026/01/01' }, 'YYYY-MM-DD'],
    [
      { reportType: 'balance_sheet', startDate: '2026-12-31', endDate: '2026-01-01' },
      'cannot be after',
    ],
    [{ reportType: 'vendor_balance', startDate: '2026-01-01' }, 'does not support startDate'],
    [{ reportType: 'cash_flow', accountingMethod: 'cash' }, 'accountingMethod'],
    [{ reportType: 'profit_and_loss_detail', summarizeBy: 'month' }, 'summarizeBy'],
    [{ reportType: 'trial_balance', customerId: '42' }, 'customerId'],
    [{ reportType: 'balance_sheet', accountId: '7' }, 'accountId'],
    [{ reportType: 'profit_and_loss', agingMethod: 'current' }, 'agingMethod'],
    [{ reportType: 'ap_aging_summary', agingDays: 0 }, 'positive integer'],
    [{ reportType: 'ap_aging_summary', agingDays: 2.5 }, 'positive integer'],
    [{ reportType: 'unknown' }, 'Unsupported QuickBooks report type'],
  ] as const)('rejects invalid or unsupported input before fetch', (partial, message) => {
    expect(() =>
      buildQuickBooksReportUrl({
        ...authParams,
        ...(partial as Partial<QuickBooksRunFinancialReportParams>),
      } as QuickBooksRunFinancialReportParams)
    ).toThrow(message)
  })

  it('contains exactly the sandbox-verified 14-report support matrix', () => {
    expect(Object.keys(QUICKBOOKS_REPORTS)).toEqual(reportEndpoints.map(([type]) => type))
    expect(Object.keys(QUICKBOOKS_REPORTS)).not.toContain('general_ledger')
    expect(quickbooksRunFinancialReportTool.params).not.toHaveProperty('transactionType')
  })
})

describe('QuickBooks reporting-dimension discovery', () => {
  it.each([
    ['class', 'Class', 'class'],
    ['department', 'Department', 'department'],
  ] as const)('lists and reads %s records by ID', async (recordType, entity, resource) => {
    const requestUrl = quickbooksReadMasterDataTool.request.url as (
      params: QuickBooksReadMasterDataParams
    ) => string
    const listParams = {
      ...authParams,
      recordType,
      readMode: 'list' as const,
      startPosition: 1,
      maxResults: 25,
    }
    const listUrl = new URL(requestUrl(listParams))
    expect(listUrl.searchParams.get('query')).toBe(
      `SELECT * FROM ${entity} STARTPOSITION 1 MAXRESULTS 25`
    )

    const byIdUrl = new URL(requestUrl({ ...listParams, readMode: 'by_id', recordId: ' A/B ' }))
    expect(byIdUrl.pathname).toBe(`/v3/company/123456789/${resource}/A%2FB`)

    await expect(
      quickbooksReadMasterDataTool.transformResponse!(
        Response.json({
          QueryResponse: {
            [entity]: [
              {
                Id: '8',
                SyncToken: '0',
                Name: `Sanitized ${entity}`,
                Active: true,
                FullyQualifiedName: `Sanitized ${entity}`,
              },
            ],
          },
          time: 'test-time',
        }),
        listParams
      )
    ).resolves.toMatchObject({
      output: {
        recordType,
        items: [{ Id: '8', Name: `Sanitized ${entity}`, Active: true }],
        time: 'test-time',
      },
    })

    await expect(
      quickbooksReadMasterDataTool.transformResponse!(
        Response.json({
          [entity]: { Id: '8', SyncToken: '0', Name: `Sanitized ${entity}` },
          time: 'test-time',
        }),
        { ...listParams, readMode: 'by_id', recordId: '8' }
      )
    ).resolves.toMatchObject({
      output: { recordType, item: { Id: '8', Name: `Sanitized ${entity}` }, time: 'test-time' },
    })
  })
})

describe('QuickBooks financial report responses', () => {
  const params: QuickBooksRunFinancialReportParams = {
    ...authParams,
    reportType: 'profit_and_loss',
  }

  it('preserves native columns and nested report rows without duplicating the report', async () => {
    const result = await quickbooksRunFinancialReportTool.transformResponse!(
      Response.json({
        Header: {
          Time: 'test-time',
          ReportName: 'ProfitAndLoss',
          ReportBasis: 'Accrual',
          Currency: 'USD',
          Option: [{ Name: 'NoReportData', Value: 'false' }],
        },
        Columns: { Column: [{ ColTitle: 'Account', ColType: 'Account' }] },
        Rows: {
          Row: [
            {
              type: 'Section',
              group: 'Income',
              Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Income', id: '7' }] }] },
              Summary: { ColData: [{ value: 'Total Income' }, { value: '100.00' }] },
            },
          ],
        },
      }),
      params
    )

    expect(result.output).toMatchObject({
      reportType: 'profit_and_loss',
      header: { ReportName: 'ProfitAndLoss', ReportBasis: 'Accrual' },
      columns: { Column: [{ ColTitle: 'Account' }] },
      rows: { Row: [{ group: 'Income', Rows: { Row: [{ type: 'Data' }] } }] },
      time: 'test-time',
    })
    expect(result.output).not.toHaveProperty('report')
  })

  it('accepts a valid no-data report with an empty native Rows object', async () => {
    await expect(
      quickbooksRunFinancialReportTool.transformResponse!(
        Response.json({
          Header: { Option: [{ Name: 'NoReportData', Value: 'true' }] },
          Columns: { Column: [] },
          Rows: {},
        }),
        params
      )
    ).resolves.toMatchObject({ output: { columns: { Column: [] }, rows: {}, time: null } })
  })

  it.each(['Header', 'Columns', 'Rows'] as const)(
    'rejects a missing or malformed %s section',
    async (section) => {
      const envelope: Record<string, unknown> = { Header: {}, Columns: {}, Rows: {} }
      envelope[section] = section === 'Rows' ? [] : undefined
      await expect(
        quickbooksRunFinancialReportTool.transformResponse!(Response.json(envelope), params)
      ).rejects.toThrow(section)
    }
  )

  it('rejects the response before parsing when it exceeds 8 MiB', async () => {
    const oversized = JSON.stringify({
      Header: {},
      Columns: {},
      Rows: { padding: 'x'.repeat(QUICKBOOKS_MAX_RESPONSE_BYTES) },
    })
    await expect(
      quickbooksRunFinancialReportTool.transformResponse!(new Response(oversized), params)
    ).rejects.toThrow(/exceeds maximum size/)
  })

  it('uses one bounded GET request with retries disabled', () => {
    expect(quickbooksRunFinancialReportTool.request.method).toBe('GET')
    expect(quickbooksRunFinancialReportTool.request.retry).toEqual({ enabled: false })
    expect(quickbooksRunFinancialReportTool.request.maxResponseBytes).toBe(
      QUICKBOOKS_MAX_RESPONSE_BYTES
    )
    expect(quickbooksRunFinancialReportTool.postProcess).toBeUndefined()
  })
})

describe('QuickBooks report block behavior', () => {
  const subBlocks = Object.fromEntries(
    QuickBooksBlock.subBlocks.map((subBlock) => [subBlock.id, subBlock])
  )

  it('shows only controls supported by the selected report', () => {
    expect(
      evaluateSubBlockCondition(subBlocks.reportAccountId.condition, {
        operation: 'quickbooks_run_financial_report',
        reportType: 'profit_and_loss',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockCondition(subBlocks.reportAccountId.condition, {
        operation: 'quickbooks_run_financial_report',
        reportType: 'balance_sheet',
      })
    ).toBe(false)
    expect(
      evaluateSubBlockCondition(subBlocks.reportAgingDays.condition, {
        operation: 'quickbooks_run_financial_report',
        reportType: 'ar_aging_detail',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockCondition(subBlocks.reportAgingDays.condition, {
        operation: 'quickbooks_run_financial_report',
        reportType: 'customer_balance',
      })
    ).toBe(false)
    const optionIds = (subBlockId: string) => {
      const options = subBlocks[subBlockId].options
      return (typeof options === 'function' ? options() : (options ?? [])).map(
        (option) => option.id
      )
    }
    expect(optionIds('reportTimeSummarizeBy')).not.toContain('customer')
    expect(optionIds('reportCustomerSalesSummarizeBy')).not.toContain('vendor')
    expect(optionIds('reportVendorExpenseSummarizeBy')).not.toContain('item')
  })

  it('coerces report values after resolution and discards hidden stale controls', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_run_financial_report',
        oauthCredential: 'credential-id',
        reportType: 'ap_aging_summary',
        reportEndDate: '2026-08-02',
        reportVendorId: '62',
        reportAccountId: 'stale-hidden-value',
        reportAccountingMethod: 'cash',
        reportAgingMethod: 'current',
        reportAgingDays: '15',
      })
    ).toEqual({
      credential: 'credential-id',
      reportType: 'ap_aging_summary',
      startDate: undefined,
      endDate: '2026-08-02',
      accountingMethod: undefined,
      summarizeBy: undefined,
      customerId: undefined,
      vendorId: '62',
      accountId: undefined,
      itemId: undefined,
      classId: undefined,
      departmentId: undefined,
      agingMethod: 'current',
      agingDays: 15,
    })
  })

  it('omits blank report filters serialized as null by the editor', () => {
    const params = QuickBooksBlock.tools.config!.params!({
      operation: 'quickbooks_run_financial_report',
      oauthCredential: 'credential-id',
      reportType: 'ap_aging_summary',
      reportEndDate: '2026-08-02',
      reportVendorId: null,
      reportDepartmentId: null,
      reportAgingMethod: 'report_date',
      reportAgingDays: '30',
    })

    expect(params.vendorId).toBeUndefined()
    expect(params.departmentId).toBeUndefined()

    const url = buildQuickBooksReportUrl({
      ...authParams,
      ...params,
    } as QuickBooksRunFinancialReportParams)
    expect(url.searchParams.has('vendor')).toBe(false)
    expect(url.searchParams.has('department')).toBe(false)
  })

  it('keeps support arrays consistent with the block conditions', () => {
    expect(getQuickBooksReportTypesSupporting('aging')).toEqual([
      'ap_aging_detail',
      'ap_aging_summary',
      'ar_aging_detail',
      'ar_aging_summary',
    ])
    expect(getQuickBooksReportTypesSupporting('accountId')).toEqual([
      'profit_and_loss',
      'profit_and_loss_detail',
    ])
    expect(
      getQuickBooksReportTypesSupporting('summarizeBy').every((reportType) =>
        QUICKBOOKS_REPORTS[reportType].summarizeBy.some(
          (value) => value !== ('default' as QuickBooksReportSummarizeBy)
        )
      )
    ).toBe(true)
  })
})
