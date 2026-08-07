import type {
  QuickBooksAccountingMethod,
  QuickBooksAgingMethod,
  QuickBooksReportSummarizeBy,
  QuickBooksReportType,
  QuickBooksRunFinancialReportParams,
} from '@/tools/quickbooks/types'
import { optionalQuickBooksString, validateQuickBooksDate } from '@/tools/quickbooks/values'

/**
 * The QuickBooks reporting capability table and everything derived from it.
 *
 * This module is runtime-free — it validates and shapes report query
 * parameters but never builds a request or touches the API client — so the
 * block definition can read the same capability table the tool executes
 * against without pulling the QuickBooks HTTP client into the client bundle.
 */

type QuickBooksReportFilter =
  | 'customerId'
  | 'vendorId'
  | 'accountId'
  | 'itemId'
  | 'classId'
  | 'departmentId'

type QuickBooksReportDateMode = 'range' | 'as_of'

/**
 * Capabilities of a single QuickBooks report endpoint, mirroring the query
 * parameters Intuit documents for it. This table is the only source of truth:
 * both URL construction and the block's control visibility derive from it, so
 * a capability must never be restated anywhere else.
 *
 * `agingMethod` and `agingPeriod` are tracked separately because no aging
 * report supports both: the summary endpoints document `aging_method` only,
 * `AgedPayableDetail` documents `aging_period` only, and `AgedReceivableDetail`
 * is the sole endpoint documenting both.
 */
interface QuickBooksReportDefinition {
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

/**
 * A user-facing report control. `agingMethod` and `agingPeriod` correspond
 * one-to-one with Intuit's `aging_method` and `aging_period` query parameters
 * and must stay distinct: the detail and summary aging reports each support one
 * and reject the other, so a control matching either would surface an input the
 * report refuses at execution time.
 */
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

const QUICKBOOKS_REPORT_SUMMARIZE_VALUES: Record<
  Exclude<QuickBooksReportSummarizeBy, 'default'>,
  string
> = {
  total: 'Total',
  day: 'Days',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
  customer: 'Customers',
  vendor: 'Vendors',
  item: 'ProductsAndServices',
  class: 'Classes',
  department: 'Departments',
}

const QUICKBOOKS_ACCOUNTING_METHOD_VALUES: Record<
  Exclude<QuickBooksAccountingMethod, 'default'>,
  string
> = {
  cash: 'Cash',
  accrual: 'Accrual',
}

const QUICKBOOKS_AGING_METHOD_VALUES: Record<Exclude<QuickBooksAgingMethod, 'default'>, string> = {
  report_date: 'Report_Date',
  current: 'Current',
}

const QUICKBOOKS_REPORT_FILTER_PARAMS: Record<QuickBooksReportFilter, string> = {
  customerId: 'customer',
  vendorId: 'vendor',
  accountId: 'account',
  itemId: 'item',
  classId: 'class',
  departmentId: 'department',
}

const QUICKBOOKS_TRANSACTION_LIST_VALUES = {
  transactionType: {
    default: '',
    bill: 'Bill',
    bill_payment_check: 'BillPaymentCheck',
    bill_payment_credit_card: 'BillPaymentCreditCard',
    cash_purchase: 'CashPurchase',
    check: 'Check',
    credit_card_charge: 'CreditCardCharge',
    credit_card_credit: 'CreditCardCredit',
    credit_memo: 'CreditMemo',
    deposit: 'Deposit',
    estimate: 'Estimate',
    invoice: 'Invoice',
    journal_entry: 'JournalEntry',
    payment: 'ReceivePayment',
    purchase_order: 'PurchaseOrder',
    sales_receipt: 'SalesReceipt',
    transfer: 'Transfer',
    vendor_credit: 'VendorCredit',
  },
  groupBy: {
    default: '',
    account: 'Account',
    customer: 'Customer',
    day: 'Day',
    department: 'Location',
    employee: 'Employee',
    month: 'Month',
    name: 'Name',
    none: 'None',
    payment_method: 'Payment Method',
    quarter: 'Quarter',
    transaction_type: 'Transaction Type',
    vendor: 'Vendor',
    week: 'Week',
    year: 'Year',
  },
  paidStatus: { default: '', all: 'All', paid: 'Paid', unpaid: 'Unpaid' },
  clearedStatus: {
    default: '',
    cleared: 'Cleared',
    deposited: 'Deposited',
    reconciled: 'Reconciled',
    uncleared: 'Uncleared',
  },
  sourceAccountType: {
    default: '',
    accounts_payable: 'AccountsPayable',
    accounts_receivable: 'AccountsReceivable',
    bank: 'Bank',
    cost_of_goods_sold: 'CostOfGoodsSold',
    credit_card: 'CreditCard',
    equity: 'Equity',
    expense: 'Expense',
    fixed_asset: 'FixedAsset',
    income: 'Income',
    long_term_liability: 'LongTermLiability',
    non_posting: 'NonPosting',
    other_asset: 'OtherAsset',
    other_current_asset: 'OtherCurrentAsset',
    other_current_liability: 'OtherCurrentLiability',
    other_expense: 'OtherExpense',
    other_income: 'OtherIncome',
  },
} as const

function getQuickBooksTransactionListControl(
  value: unknown,
  values: Record<string, string>,
  field: string
): string | undefined {
  if (value === undefined || value === 'default') return undefined
  if (typeof value !== 'string' || !Object.hasOwn(values, value) || !values[value]) {
    throw new Error(`Unsupported QuickBooks ${field}: ${String(value)}`)
  }
  return values[value]
}

function addQuickBooksTransactionListFilters(
  url: URL,
  params: QuickBooksRunFinancialReportParams
): void {
  const transactionType = getQuickBooksTransactionListControl(
    params.transactionType,
    QUICKBOOKS_TRANSACTION_LIST_VALUES.transactionType,
    'transactionType'
  )
  const groupBy = getQuickBooksTransactionListControl(
    params.groupBy,
    QUICKBOOKS_TRANSACTION_LIST_VALUES.groupBy,
    'groupBy'
  )
  const accountsPayablePaid = getQuickBooksTransactionListControl(
    params.accountsPayablePaid,
    QUICKBOOKS_TRANSACTION_LIST_VALUES.paidStatus,
    'accountsPayablePaid'
  )
  const accountsReceivablePaid = getQuickBooksTransactionListControl(
    params.accountsReceivablePaid,
    QUICKBOOKS_TRANSACTION_LIST_VALUES.paidStatus,
    'accountsReceivablePaid'
  )
  const clearedStatus = getQuickBooksTransactionListControl(
    params.clearedStatus,
    QUICKBOOKS_TRANSACTION_LIST_VALUES.clearedStatus,
    'clearedStatus'
  )
  const sourceAccountType = getQuickBooksTransactionListControl(
    params.sourceAccountType,
    QUICKBOOKS_TRANSACTION_LIST_VALUES.sourceAccountType,
    'sourceAccountType'
  )
  const controls = {
    transaction_type: transactionType,
    group_by: groupBy,
    appaid: accountsPayablePaid,
    arpaid: accountsReceivablePaid,
    cleared: clearedStatus,
    docnum: optionalQuickBooksString(params.documentNumber),
    source_account_type: sourceAccountType,
  }
  const supplied = Object.entries(controls).find(([, value]) => value !== undefined)
  if (params.reportType !== 'transaction_list') {
    if (supplied) throw new Error(`${params.reportType} does not support ${supplied[0]}`)
    return
  }

  if (transactionType) url.searchParams.set('transaction_type', transactionType)
  if (groupBy) url.searchParams.set('group_by', groupBy)
  if (accountsPayablePaid) url.searchParams.set('appaid', accountsPayablePaid)
  if (accountsReceivablePaid) url.searchParams.set('arpaid', accountsReceivablePaid)
  if (clearedStatus) url.searchParams.set('cleared', clearedStatus)
  if (controls.docnum) url.searchParams.set('docnum', controls.docnum)
  if (sourceAccountType) url.searchParams.set('source_account_type', sourceAccountType)
}

/**
 * Resolves the Intuit report endpoint and its date query parameters.
 *
 * Split from {@link applyQuickBooksReportParams} so the caller can build the
 * company URL — the only part of report URL construction that needs the API
 * client — between the two, preserving the original validation order.
 */
export function resolveQuickBooksReportEndpoint(params: QuickBooksRunFinancialReportParams): {
  endpoint: string
  dateParams: Array<[string, string]>
} {
  const definition = QUICKBOOKS_REPORTS[params.reportType]
  if (!definition) {
    throw new Error(`Unsupported QuickBooks report type: ${String(params.reportType)}`)
  }

  const startDate = validateQuickBooksDate(params.startDate, 'startDate')
  const endDate = validateQuickBooksDate(params.endDate, 'endDate')
  if (startDate && definition.dateMode !== 'range') {
    throw new Error(`${params.reportType} does not support startDate`)
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error('startDate cannot be after endDate')
  }

  const dateParams: Array<[string, string]> = []
  if (startDate) dateParams.push(['start_date', startDate])
  if (endDate) {
    dateParams.push([definition.dateMode === 'as_of' ? 'report_date' : 'end_date', endDate])
  }
  return { endpoint: definition.endpoint, dateParams }
}

/**
 * Applies every non-date report query parameter to `url`, rejecting any
 * control the requested report does not document support for.
 */
export function applyQuickBooksReportParams(
  url: URL,
  params: QuickBooksRunFinancialReportParams
): void {
  const definition: QuickBooksReportDefinition = QUICKBOOKS_REPORTS[params.reportType]

  const accountingMethod = params.accountingMethod ?? 'default'
  if (accountingMethod !== 'default') {
    if (!definition.accountingMethod) {
      throw new Error(`${params.reportType} does not support accountingMethod`)
    }
    const value = QUICKBOOKS_ACCOUNTING_METHOD_VALUES[accountingMethod]
    if (!value) throw new Error(`Unsupported QuickBooks accounting method: ${accountingMethod}`)
    url.searchParams.set('accounting_method', value)
  }

  const summarizeBy = params.summarizeBy ?? 'default'
  if (summarizeBy !== 'default') {
    if (!(definition.summarizeBy as readonly string[]).includes(summarizeBy)) {
      throw new Error(`${params.reportType} does not support summarizeBy=${summarizeBy}`)
    }
    const value = QUICKBOOKS_REPORT_SUMMARIZE_VALUES[summarizeBy]
    if (!value) throw new Error(`Unsupported QuickBooks report summarization: ${summarizeBy}`)
    url.searchParams.set('summarize_column_by', value)
  }

  for (const filter of Object.keys(QUICKBOOKS_REPORT_FILTER_PARAMS) as QuickBooksReportFilter[]) {
    const value = optionalQuickBooksString(params[filter])
    if (!value) continue
    if (!(definition.filters as readonly QuickBooksReportFilter[]).includes(filter)) {
      throw new Error(`${params.reportType} does not support ${filter}`)
    }
    url.searchParams.set(QUICKBOOKS_REPORT_FILTER_PARAMS[filter], value)
  }

  const agingMethod = params.agingMethod ?? 'default'
  if (agingMethod !== 'default') {
    if (!definition.agingMethod) {
      throw new Error(`${params.reportType} does not support agingMethod`)
    }
    const value = QUICKBOOKS_AGING_METHOD_VALUES[agingMethod]
    if (!value) throw new Error(`Unsupported QuickBooks aging method: ${agingMethod}`)
    url.searchParams.set('aging_method', value)
  }
  if (params.agingDays !== undefined) {
    if (!definition.agingPeriod) throw new Error(`${params.reportType} does not support agingDays`)
    if (!Number.isInteger(params.agingDays) || params.agingDays < 1) {
      throw new Error('agingDays must be a positive integer')
    }
    url.searchParams.set('aging_period', String(params.agingDays))
  }

  addQuickBooksTransactionListFilters(url, params)
}
