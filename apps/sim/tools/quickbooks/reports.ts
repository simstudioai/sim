import {
  QUICKBOOKS_REPORTS,
  type QuickBooksReportDefinition,
  type QuickBooksReportFilter,
} from '@/tools/quickbooks/report-metadata'
import type {
  QuickBooksAccountingMethod,
  QuickBooksAgingMethod,
  QuickBooksReportDateMacro,
  QuickBooksReportSummarizeBy,
  QuickBooksRunFinancialReportParams,
} from '@/tools/quickbooks/types'
import { optionalQuickBooksString, validateQuickBooksDate } from '@/tools/quickbooks/values'

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

/**
 * Intuit's `date_macro` values, spelled exactly as the report query models document them.
 */
const QUICKBOOKS_REPORT_DATE_MACRO_VALUES: Record<
  Exclude<QuickBooksReportDateMacro, 'default'>,
  string
> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This Week',
  last_week: 'Last Week',
  this_week_to_date: 'This Week-to-date',
  last_week_to_date: 'Last Week-to-date',
  next_week: 'Next Week',
  next_4_weeks: 'Next 4 Weeks',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_month_to_date: 'This Month-to-date',
  last_month_to_date: 'Last Month-to-date',
  next_month: 'Next Month',
  this_fiscal_quarter: 'This Fiscal Quarter',
  last_fiscal_quarter: 'Last Fiscal Quarter',
  this_fiscal_quarter_to_date: 'This Fiscal Quarter-to-date',
  last_fiscal_quarter_to_date: 'Last Fiscal Quarter-to-date',
  next_fiscal_quarter: 'Next Fiscal Quarter',
  this_fiscal_year: 'This Fiscal Year',
  last_fiscal_year: 'Last Fiscal Year',
  this_fiscal_year_to_date: 'This Fiscal Year-to-date',
  last_fiscal_year_to_date: 'Last Fiscal Year-to-date',
  next_fiscal_year: 'Next Fiscal Year',
}

const QUICKBOOKS_REPORT_FILTER_PARAMS: Record<QuickBooksReportFilter, string> = {
  customerId: 'customer',
  vendorId: 'vendor',
  accountId: 'account',
  employeeId: 'employee',
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

  const dateMacro = params.dateMacro ?? 'default'
  if (dateMacro !== 'default') {
    if (!definition.dateMacro) {
      throw new Error(`${params.reportType} does not support dateMacro`)
    }
    if (startDate || endDate) {
      throw new Error('dateMacro cannot be combined with startDate or endDate')
    }
    const value = QUICKBOOKS_REPORT_DATE_MACRO_VALUES[dateMacro]
    if (!value) throw new Error(`Unsupported QuickBooks date macro: ${String(dateMacro)}`)
    dateParams.push(['date_macro', value])
  }

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

  if (params.quickZoomUrl !== undefined) {
    if (typeof params.quickZoomUrl !== 'boolean') {
      throw new Error('quickZoomUrl must be a boolean')
    }
    if (params.quickZoomUrl) {
      if (!definition.quickZoomUrl) {
        throw new Error(`${params.reportType} does not support quickZoomUrl`)
      }
      url.searchParams.set('qzurl', 'true')
    }
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
