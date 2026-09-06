import type { QuickBooksReportSummarizeBy, QuickBooksReportType } from '@/tools/quickbooks/types'

export type QuickBooksReportFilter =
  | 'customerId'
  | 'vendorId'
  | 'accountId'
  | 'employeeId'
  | 'itemId'
  | 'classId'
  | 'departmentId'

type QuickBooksReportDateMode = 'range' | 'as_of'

/**
 * Capabilities for one documented QuickBooks report endpoint.
 *
 * Every flag is transcribed from that report's own `*query` model in Intuit's report catalog, so
 * a report advertises a control only when its model lists the matching query parameter. The flags
 * are deliberately not shared between related reports: Intuit's models are asymmetric even within
 * a family, and `applyQuickBooksReportParams` rejects any control a report does not advertise.
 *
 * `agingMethod` and `agingPeriod` stay separate because the summary and detail endpoints expose
 * different aging controls.
 */
export interface QuickBooksReportDefinition {
  endpoint: string
  dateMode: QuickBooksReportDateMode
  accountingMethod: boolean
  summarizeBy: readonly Exclude<QuickBooksReportSummarizeBy, 'default'>[]
  filters: readonly QuickBooksReportFilter[]
  agingMethod: boolean
  agingPeriod: boolean
  /** Report model documents `date_macro`, the predefined alternative to an explicit date range. */
  dateMacro: boolean
  /** Report model documents `qzurl`, which populates the quick-zoom `href` links on report rows. */
  quickZoomUrl: boolean
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
  'customer_income',
  'general_ledger_detail',
  'inventory_valuation_summary',
  'profit_and_loss',
  'sales_by_class',
  'sales_by_department',
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
  'trial_balance_fr',
] as const satisfies readonly QuickBooksReportType[]

export const QUICKBOOKS_REPORTS = {
  /** `accountlistquery` carries only account and date-window controls — no macro, filter, or basis. */
  account_list_detail: {
    endpoint: 'AccountList',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: [],
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: false,
    quickZoomUrl: false,
  },
  /** `agedpayabledetailquery` is the one aging report whose model documents `accounting_method`. */
  ap_aging_detail: {
    endpoint: 'AgedPayableDetail',
    dateMode: 'as_of',
    accountingMethod: true,
    summarizeBy: [],
    filters: ['vendorId'],
    agingMethod: false,
    agingPeriod: true,
    dateMacro: false,
    quickZoomUrl: false,
  },
  /** `agedpayablesquery` documents `customer` alongside `vendor`, unlike its detail sibling. */
  ap_aging_summary: {
    endpoint: 'AgedPayables',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'departmentId'],
    agingMethod: true,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  ar_aging_detail: {
    endpoint: 'AgedReceivableDetail',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId'],
    agingMethod: true,
    agingPeriod: true,
    dateMacro: false,
    quickZoomUrl: false,
  },
  ar_aging_summary: {
    endpoint: 'AgedReceivables',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'departmentId'],
    agingMethod: true,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  balance_sheet: {
    endpoint: 'BalanceSheet',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  /** `cashflowquery` is the only statement report documenting neither `accounting_method` nor `qzurl`. */
  cash_flow: {
    endpoint: 'CashFlow',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  customer_balance: {
    endpoint: 'CustomerBalance',
    dateMode: 'as_of',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /** `customerbalancedetailquery` documents `aging_method` but neither a basis nor `date_macro`. */
  customer_balance_detail: {
    endpoint: 'CustomerBalanceDetail',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'departmentId'],
    agingMethod: true,
    agingPeriod: false,
    dateMacro: false,
    quickZoomUrl: false,
  },
  /** `customerincomequery` filters by vendor but, unlike the sales reports, not by item. */
  customer_income: {
    endpoint: 'CustomerIncome',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  expenses_by_vendor: {
    endpoint: 'VendorExpenses',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: VENDOR_EXPENSE_SUMMARIES,
    filters: ['customerId', 'vendorId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /** Intuit titles the `GeneralLedger` endpoint the "General Ledger Detail" report. */
  general_ledger_detail: {
    endpoint: 'GeneralLedger',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'accountId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /** `inventoryvaluationdetailquery` documents no entity filters and no basis. */
  inventory_valuation_detail: {
    endpoint: 'InventoryValuationDetail',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: [],
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /** The summary endpoint is backed by `inventoryvaluationquery`, which filters only by item. */
  inventory_valuation_summary: {
    endpoint: 'InventoryValuationSummary',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: ALL_SUMMARIES,
    filters: ['itemId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  profit_and_loss: {
    endpoint: 'ProfitAndLoss',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  /** `profitandlossdetailquery` is the only report model documenting an `employee` filter. */
  profit_and_loss_detail: {
    endpoint: 'ProfitAndLossDetail',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'accountId', 'employeeId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  sales_by_class: {
    endpoint: 'ClassSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  sales_by_customer: {
    endpoint: 'CustomerSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: CUSTOMER_SALES_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  sales_by_department: {
    endpoint: 'DepartmentSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /** `itemsalesquery` documents no `qzurl`, unlike its `customersalesquery` sibling. */
  sales_by_item: {
    endpoint: 'ItemSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: CUSTOMER_SALES_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /** Intuit documents Tax Summary as applicable to non-US locale companies only. */
  tax_summary: {
    endpoint: 'TaxSummary',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: [],
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  trial_balance: {
    endpoint: 'TrialBalance',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: TIME_SUMMARIES,
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /**
   * France-locale Trial Balance. Intuit documents one report backed by `trialbalancequery` with
   * two endpoints — `TrialBalanceFR` for FR-locale companies and `TrialBalance` for every other
   * locale — so the capabilities match `trial_balance` exactly and only the endpoint differs.
   */
  trial_balance_fr: {
    endpoint: 'TrialBalanceFR',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: TIME_SUMMARIES,
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
  /**
   * Transaction List is a catalog-confirmed operation
   * (`GET /v3/company/<realmID>/reports/TransactionList`). Its `transactionlistquery` model
   * documents every control Sim exposes here — `appaid`, `arpaid`, `cleared`, `docnum`,
   * `source_account_type`, `transaction_type`, and `group_by` — and documents neither
   * `accounting_method` nor `summarize_column_by`, which is why both are absent below.
   */
  transaction_list: {
    endpoint: 'TransactionList',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  vendor_balance: {
    endpoint: 'VendorBalance',
    dateMode: 'as_of',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['vendorId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
  },
  /** `vendorbalancedetailquery` documents a basis but, unlike the AR detail report, no aging. */
  vendor_balance_detail: {
    endpoint: 'VendorBalanceDetail',
    dateMode: 'as_of',
    accountingMethod: true,
    summarizeBy: [],
    filters: ['vendorId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
  },
} as const satisfies Record<QuickBooksReportType, QuickBooksReportDefinition>

export type QuickBooksReportControl =
  | 'startDate'
  | 'endDate'
  | 'dateMacro'
  | 'accountingMethod'
  | 'summarizeBy'
  | 'quickZoomUrl'
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
      if (control === 'dateMacro') return definition.dateMacro
      if (control === 'accountingMethod') return definition.accountingMethod
      if (control === 'summarizeBy') return definition.summarizeBy.length > 0
      if (control === 'quickZoomUrl') return definition.quickZoomUrl
      if (control === 'agingMethod') return definition.agingMethod
      if (control === 'agingPeriod') return definition.agingPeriod
      return definition.filters.includes(control)
    })
    .map(([reportType]) => reportType)
}
