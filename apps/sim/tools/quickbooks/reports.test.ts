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
