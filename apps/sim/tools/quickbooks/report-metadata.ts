import type { QuickBooksReportSummarizeBy, QuickBooksReportType } from '@/tools/quickbooks/types'

export type QuickBooksReportFilter =
  | 'customerId'
  | 'vendorId'
  | 'accountId'
  | 'itemId'
  | 'classId'
  | 'departmentId'

type QuickBooksReportDateMode = 'range' | 'as_of'

/**
 * Capabilities for one documented QuickBooks report endpoint.
 *
 * `agingMethod` and `agingPeriod` stay separate because the summary and detail
 * endpoints expose different aging controls.
 */
export interface QuickBooksReportDefinition {
  endpoint: string
  dateMode: QuickBooksReportDateMode
  accountingMethod: boolean
  summarizeBy: readonly Exclude<QuickBooksReportSummarizeBy, 'default'>[]
  filters: readonly QuickBooksReportFilter[]
  agingMethod: boolean
  agingPeriod: boolean
}

const TIME_SUMMARIES = ['total', 'day', 'week', 'month', 'quarter', 'year'] as const
const ALL_SUMMARIES = [
  ...TIME_SUMMARIES,
  'customer',
  'vendor',
  'item',
  'class',
  'department',
] as const
const CUSTOMER_SALES_SUMMARIES = [
  ...TIME_SUMMARIES,
  'customer',
  'item',
  'class',
  'department',
] as const
const VENDOR_EXPENSE_SUMMARIES = [
  ...TIME_SUMMARIES,
  'customer',
  'vendor',
  'class',
  'department',
] as const

export const QUICKBOOKS_REPORT_TYPES_WITH_ALL_SUMMARIES = [
  'balance_sheet',
  'cash_flow',
  'customer_balance',
  'profit_and_loss',
  'vendor_balance',
] as const satisfies readonly QuickBooksReportType[]

export const QUICKBOOKS_REPORT_TYPES_WITH_CUSTOMER_SALES_SUMMARIES = [
  'sales_by_customer',
  'sales_by_item',
] as const satisfies readonly QuickBooksReportType[]

export const QUICKBOOKS_REPORT_TYPES_WITH_VENDOR_EXPENSE_SUMMARIES = [
  'expenses_by_vendor',
] as const satisfies readonly QuickBooksReportType[]

export const QUICKBOOKS_REPORT_TYPES_WITH_TIME_SUMMARIES = [
  'trial_balance',
] as const satisfies readonly QuickBooksReportType[]

export const QUICKBOOKS_REPORTS = {
  ap_aging_detail: {
    endpoint: 'AgedPayableDetail',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['vendorId'],
    agingMethod: false,
    agingPeriod: true,
  },
  ap_aging_summary: {
    endpoint: 'AgedPayables',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['vendorId', 'departmentId'],
    agingMethod: true,
    agingPeriod: false,
  },
  ar_aging_detail: {
    endpoint: 'AgedReceivableDetail',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId'],
    agingMethod: true,
    agingPeriod: true,
  },
  ar_aging_summary: {
    endpoint: 'AgedReceivables',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'departmentId'],
    agingMethod: true,
    agingPeriod: false,
  },
  balance_sheet: {
    endpoint: 'BalanceSheet',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  cash_flow: {
    endpoint: 'CashFlow',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  customer_balance: {
    endpoint: 'CustomerBalance',
    dateMode: 'as_of',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  expenses_by_vendor: {
    endpoint: 'VendorExpenses',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: VENDOR_EXPENSE_SUMMARIES,
    filters: ['customerId', 'vendorId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  profit_and_loss: {
    endpoint: 'ProfitAndLoss',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  profit_and_loss_detail: {
    endpoint: 'ProfitAndLossDetail',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'accountId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  sales_by_customer: {
    endpoint: 'CustomerSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: CUSTOMER_SALES_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  sales_by_item: {
    endpoint: 'ItemSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: CUSTOMER_SALES_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  trial_balance: {
    endpoint: 'TrialBalance',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: TIME_SUMMARIES,
    filters: [],
    agingMethod: false,
    agingPeriod: false,
  },
  transaction_list: {
    endpoint: 'TransactionList',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
  vendor_balance: {
    endpoint: 'VendorBalance',
    dateMode: 'as_of',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['vendorId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
  },
} as const satisfies Record<QuickBooksReportType, QuickBooksReportDefinition>

export type QuickBooksReportControl =
  | 'startDate'
  | 'endDate'
  | 'accountingMethod'
  | 'summarizeBy'
  | QuickBooksReportFilter
  | 'agingMethod'
  | 'agingPeriod'

export function getQuickBooksReportTypesSupporting(
  control: QuickBooksReportControl
): QuickBooksReportType[] {
  return (
    Object.entries(QUICKBOOKS_REPORTS) as Array<[QuickBooksReportType, QuickBooksReportDefinition]>
  )
    .filter(([, definition]) => {
      if (control === 'startDate') return definition.dateMode === 'range'
      if (control === 'endDate') return true
      if (control === 'accountingMethod') return definition.accountingMethod
      if (control === 'summarizeBy') return definition.summarizeBy.length > 0
      if (control === 'agingMethod') return definition.agingMethod
      if (control === 'agingPeriod') return definition.agingPeriod
      return definition.filters.includes(control)
    })
    .map(([reportType]) => reportType)
}
