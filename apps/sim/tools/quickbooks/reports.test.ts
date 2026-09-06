/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getQuickBooksReportTypesSupporting } from '@/tools/quickbooks/report-metadata'
import {
  applyQuickBooksReportParams,
  resolveQuickBooksReportEndpoint,
} from '@/tools/quickbooks/reports'
import type { QuickBooksRunFinancialReportParams } from '@/tools/quickbooks/types'

const AUTH = { accessToken: 'token', realmId: '123', quickBooksEnvironment: 'sandbox' } as const

function reportParams(
  overrides: Partial<QuickBooksRunFinancialReportParams> = {}
): QuickBooksRunFinancialReportParams {
  return { ...AUTH, reportType: 'profit_and_loss', ...overrides }
}

describe('QuickBooks report capabilities', () => {
  it('maps range and as-of reports to their documented date parameters', () => {
    expect(
      resolveQuickBooksReportEndpoint(
        reportParams({
          reportType: 'profit_and_loss',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
        })
      )
    ).toEqual({
      endpoint: 'ProfitAndLoss',
      dateParams: [
        ['start_date', '2026-01-01'],
        ['end_date', '2026-06-30'],
      ],
    })

    expect(
      resolveQuickBooksReportEndpoint(
        reportParams({ reportType: 'ar_aging_summary', endDate: '2026-06-30' })
      )
    ).toEqual({
      endpoint: 'AgedReceivables',
      dateParams: [['report_date', '2026-06-30']],
    })
  })

  it('rejects invalid date ranges and range inputs on as-of reports', () => {
    expect(() =>
      resolveQuickBooksReportEndpoint(
        reportParams({ reportType: 'vendor_balance', startDate: '2026-01-01' })
      )
    ).toThrow('vendor_balance does not support startDate')
    expect(() =>
      resolveQuickBooksReportEndpoint(
        reportParams({ startDate: '2026-07-01', endDate: '2026-06-30' })
      )
    ).toThrow('startDate cannot be after endDate')
  })

  it('encodes only report-supported accounting, summary, and entity filters', () => {
    const url = new URL('https://quickbooks.api.intuit.com/v3/company/123/reports/ProfitAndLoss')
    applyQuickBooksReportParams(
      url,
      reportParams({
        accountingMethod: 'accrual',
        summarizeBy: 'customer',
        customerId: 'customer-1',
        departmentId: 'department-1',
      })
    )

    expect(Object.fromEntries(url.searchParams)).toEqual({
      accounting_method: 'Accrual',
      summarize_column_by: 'Customers',
      customer: 'customer-1',
      department: 'department-1',
    })
    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ reportType: 'trial_balance', customerId: 'customer-1' })
      )
    ).toThrow('trial_balance does not support customerId')
  })

  it('keeps aging controls distinct by endpoint capability', () => {
    expect(getQuickBooksReportTypesSupporting('agingMethod')).toEqual([
      'ap_aging_summary',
      'ar_aging_detail',
      'ar_aging_summary',
      'customer_balance_detail',
    ])
    expect(getQuickBooksReportTypesSupporting('agingPeriod')).toEqual([
      'ap_aging_detail',
      'ar_aging_detail',
    ])

    const url = new URL('https://example.com')
    applyQuickBooksReportParams(
      url,
      reportParams({
        reportType: 'ar_aging_detail',
        agingMethod: 'report_date',
        agingDays: 30,
      })
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      aging_method: 'Report_Date',
      aging_period: '30',
    })
  })

  it('accepts the accounting method and customer filter the AP aging models document', () => {
    const detail = new URL('https://example.com')
    applyQuickBooksReportParams(
      detail,
      reportParams({ reportType: 'ap_aging_detail', accountingMethod: 'cash' })
    )
    expect(Object.fromEntries(detail.searchParams)).toEqual({ accounting_method: 'Cash' })

    const summary = new URL('https://example.com')
    applyQuickBooksReportParams(
      summary,
      reportParams({ reportType: 'ap_aging_summary', customerId: 'customer-1' })
    )
    expect(Object.fromEntries(summary.searchParams)).toEqual({ customer: 'customer-1' })

    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ reportType: 'ap_aging_summary', accountingMethod: 'cash' })
      )
    ).toThrow('ap_aging_summary does not support accountingMethod')
  })

  it('routes the France-locale trial balance to its own endpoint', () => {
    expect(
      resolveQuickBooksReportEndpoint(reportParams({ reportType: 'trial_balance_fr' })).endpoint
    ).toBe('TrialBalanceFR')
    expect(
      resolveQuickBooksReportEndpoint(reportParams({ reportType: 'trial_balance' })).endpoint
    ).toBe('TrialBalance')
  })

  it('resolves each newly covered report to its documented endpoint', () => {
    const endpoints = (
      [
        ['account_list_detail', 'AccountList'],
        ['customer_balance_detail', 'CustomerBalanceDetail'],
        ['customer_income', 'CustomerIncome'],
        ['general_ledger_detail', 'GeneralLedger'],
        ['inventory_valuation_detail', 'InventoryValuationDetail'],
        ['inventory_valuation_summary', 'InventoryValuationSummary'],
        ['sales_by_class', 'ClassSales'],
        ['sales_by_department', 'DepartmentSales'],
        ['tax_summary', 'TaxSummary'],
        ['vendor_balance_detail', 'VendorBalanceDetail'],
      ] as const
    ).map(([reportType]) => resolveQuickBooksReportEndpoint(reportParams({ reportType })).endpoint)

    expect(endpoints).toEqual([
      'AccountList',
      'CustomerBalanceDetail',
      'CustomerIncome',
      'GeneralLedger',
      'InventoryValuationDetail',
      'InventoryValuationSummary',
      'ClassSales',
      'DepartmentSales',
      'TaxSummary',
      'VendorBalanceDetail',
    ])
  })

  it('rejects controls the newly covered report models do not document', () => {
    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ reportType: 'customer_balance_detail', accountingMethod: 'cash' })
      )
    ).toThrow('customer_balance_detail does not support accountingMethod')
    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ reportType: 'customer_income', itemId: 'item-1' })
      )
    ).toThrow('customer_income does not support itemId')
    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ reportType: 'inventory_valuation_summary', customerId: 'customer-1' })
      )
    ).toThrow('inventory_valuation_summary does not support customerId')
  })

  it('sends date_macro only where documented and never beside an explicit range', () => {
    expect(
      resolveQuickBooksReportEndpoint(
        reportParams({ reportType: 'balance_sheet', dateMacro: 'last_fiscal_year_to_date' })
      ).dateParams
    ).toEqual([['date_macro', 'Last Fiscal Year-to-date']])

    expect(() =>
      resolveQuickBooksReportEndpoint(
        reportParams({ reportType: 'ar_aging_detail', dateMacro: 'this_month' })
      )
    ).toThrow('ar_aging_detail does not support dateMacro')
    expect(() =>
      resolveQuickBooksReportEndpoint(
        reportParams({ dateMacro: 'this_month', endDate: '2026-06-30' })
      )
    ).toThrow('dateMacro cannot be combined with startDate or endDate')
  })

  it('sends qzurl only where the report model documents quick-zoom links', () => {
    const url = new URL('https://example.com')
    applyQuickBooksReportParams(url, reportParams({ quickZoomUrl: true }))
    expect(Object.fromEntries(url.searchParams)).toEqual({ qzurl: 'true' })

    const omitted = new URL('https://example.com')
    applyQuickBooksReportParams(omitted, reportParams({ quickZoomUrl: false }))
    expect(Object.fromEntries(omitted.searchParams)).toEqual({})

    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ reportType: 'cash_flow', quickZoomUrl: true })
      )
    ).toThrow('cash_flow does not support quickZoomUrl')
  })

  it('accepts the employee filter only on Profit and Loss Detail', () => {
    const url = new URL('https://example.com')
    applyQuickBooksReportParams(
      url,
      reportParams({ reportType: 'profit_and_loss_detail', employeeId: 'employee-1' })
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({ employee: 'employee-1' })

    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ employeeId: 'employee-1' })
      )
    ).toThrow('profit_and_loss does not support employeeId')
  })

  it('encodes Transaction List-only controls and rejects them elsewhere', () => {
    const url = new URL('https://example.com')
    applyQuickBooksReportParams(
      url,
      reportParams({
        reportType: 'transaction_list',
        transactionType: 'invoice',
        groupBy: 'payment_method',
        accountsReceivablePaid: 'unpaid',
        documentNumber: 'INV-100',
        sourceAccountType: 'accounts_receivable',
      })
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      transaction_type: 'Invoice',
      group_by: 'Payment Method',
      arpaid: 'Unpaid',
      docnum: 'INV-100',
      source_account_type: 'AccountsReceivable',
    })

    expect(() =>
      applyQuickBooksReportParams(
        new URL('https://example.com'),
        reportParams({ documentNumber: 'INV-100' })
      )
    ).toThrow('profit_and_loss does not support docnum')
  })
})

describe('QuickBooks report controls Intuit documents beyond one report', () => {
  function applied(params: QuickBooksRunFinancialReportParams): URL {
    const url = new URL('https://quickbooks.api.intuit.com/v3/company/123/reports/Report')
    applyQuickBooksReportParams(url, params)
    return url
  }

  it('accepts every documented summarize_column_by value on every report advertising it', () => {
    for (const reportType of getQuickBooksReportTypesSupporting('summarizeBy')) {
      expect(
        applied(reportParams({ reportType, summarizeBy: 'customer' })).searchParams.get(
          'summarize_column_by'
        ),
        reportType
      ).toBe('Customers')
      expect(
        applied(reportParams({ reportType, summarizeBy: 'employee' })).searchParams.get(
          'summarize_column_by'
        ),
        reportType
      ).toBe('Employees')
    }
  })

  it('accepts the paid-status filters on the balance reports documenting them', () => {
    expect(
      applied(
        reportParams({ reportType: 'customer_balance_detail', accountsReceivablePaid: 'unpaid' })
      ).searchParams.get('arpaid')
    ).toBe('Unpaid')
    expect(
      applied(
        reportParams({ reportType: 'vendor_balance_detail', accountsPayablePaid: 'paid' })
      ).searchParams.get('appaid')
    ).toBe('Paid')
    expect(() =>
      applied(reportParams({ reportType: 'balance_sheet', accountsPayablePaid: 'paid' }))
    ).toThrow('balance_sheet does not support appaid')
  })

  it('accepts group_by on the inventory valuation detail report', () => {
    expect(
      applied(
        reportParams({ reportType: 'inventory_valuation_detail', groupBy: 'account' })
      ).searchParams.get('group_by')
    ).toBe('Account')
    expect(() =>
      applied(reportParams({ reportType: 'balance_sheet', groupBy: 'account' }))
    ).toThrow('balance_sheet does not support group_by')
  })
})
