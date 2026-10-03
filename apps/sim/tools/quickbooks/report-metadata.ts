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
  /** Report model documents `group_by`, the field the rows are grouped on. */
  groupBy: boolean
  /** Report model documents `appaid`, the payables paid-status filter. */
  accountsPayablePaid: boolean
  /** Report model documents `arpaid`, the receivables paid-status filter. */
  accountsReceivablePaid: boolean
}

/**
 * Intuit documents `summarize_column_by` on fourteen report query models, and every one of them
 * lists the identical twelve values, so one list serves every report that advertises the control.
 */
const ALL_SUMMARIES = [
  'total',
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'customer',
  'vendor',
  'employee',
  'item',
  'class',
  'department',
] as const

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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: true,
  },
  /** `customerbalancedetailquery` documents `aging_method` and `arpaid` but neither a basis nor `date_macro`. */
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: true,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
  },
  expenses_by_vendor: {
    endpoint: 'VendorExpenses',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
  },
  /** `inventoryvaluationdetailquery` documents `group_by` but no entity filters and no basis. */
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
    groupBy: true,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
  },
  sales_by_customer: {
    endpoint: 'CustomerSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: true,
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
  },
  /** `itemsalesquery` documents no `qzurl`, unlike its `customersalesquery` sibling. */
  sales_by_item: {
    endpoint: 'ItemSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
  },
  trial_balance: {
    endpoint: 'TrialBalance',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
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
    summarizeBy: ALL_SUMMARIES,
    filters: [],
    agingMethod: false,
    agingPeriod: false,
    dateMacro: true,
    quickZoomUrl: false,
    groupBy: false,
    accountsPayablePaid: false,
    accountsReceivablePaid: false,
  },
  /**
   * Transaction List is a catalog-confirmed operation
   * (`GET /v3/company/<realmID>/reports/TransactionList`). Its `transactionlistquery` model
   * documents every control Sim exposes here — `appaid`, `arpaid`, `cleared`, `docnum`,
   * `source_account_type`, `transaction_type`, and `group_by` — and documents neither
   * `accounting_method` nor `summarize_column_by`, which is why both are absent below.
   * `appaid`, `arpaid`, and `group_by` are not exclusive to it: the customer and vendor balance
   * models document the paid-status filters, and `inventoryvaluationdetailquery` documents
   * `group_by`.
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
    groupBy: true,
    accountsPayablePaid: true,
    accountsReceivablePaid: true,
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
    groupBy: false,
    accountsPayablePaid: true,
    accountsReceivablePaid: false,
  },
  /** `vendorbalancedetailquery` documents a basis and `appaid` but, unlike the AR detail report, no aging. */
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
    groupBy: false,
    accountsPayablePaid: true,
    accountsReceivablePaid: false,
  },
} as const satisfies Record<QuickBooksReportType, QuickBooksReportDefinition>

export type QuickBooksReportControl =
  | 'startDate'
  | 'endDate'
  | 'dateMacro'
  | 'accountingMethod'
  | 'summarizeBy'
  | 'quickZoomUrl'
  | 'groupBy'
  | 'accountsPayablePaid'
  | 'accountsReceivablePaid'
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
      if (control === 'groupBy') return definition.groupBy
      if (control === 'accountsPayablePaid') return definition.accountsPayablePaid
      if (control === 'accountsReceivablePaid') return definition.accountsReceivablePaid
      if (control === 'agingMethod') return definition.agingMethod
      if (control === 'agingPeriod') return definition.agingPeriod
      return definition.filters.includes(control)
    })
    .map(([reportType]) => reportType)
}
