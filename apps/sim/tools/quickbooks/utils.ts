import { omit } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'
import {
  buildQuickBooksCompanyUrl,
  buildQuickBooksHeaders,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/tools/quickbooks/client'
import { sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'
import type {
  QuickBooksAccountingMethod,
  QuickBooksAccountingTransactionType,
  QuickBooksActiveStatus,
  QuickBooksAddress,
  QuickBooksAgingMethod,
  QuickBooksCustomer,
  QuickBooksEmployee,
  QuickBooksListResponse,
  QuickBooksMasterDataRecordType,
  QuickBooksMutationResponse,
  QuickBooksPaginationParams,
  QuickBooksPurchasingTransactionType,
  QuickBooksReadAccountingTransactionsParams,
  QuickBooksReadMasterDataParams,
  QuickBooksReadPurchasingTransactionsParams,
  QuickBooksReadSalesTransactionsParams,
  QuickBooksReference,
  QuickBooksReportColumns,
  QuickBooksReportHeader,
  QuickBooksReportRows,
  QuickBooksReportSummarizeBy,
  QuickBooksReportType,
  QuickBooksRunFinancialReportParams,
  QuickBooksRunFinancialReportResponse,
  QuickBooksSalesTransactionType,
  QuickBooksVendor,
  QuickBooksWritableItemType,
} from '@/tools/quickbooks/types'

export type QuickBooksQueryEntity =
  | 'Account'
  | 'Bill'
  | 'BillPayment'
  | 'Class'
  | 'CreditMemo'
  | 'Customer'
  | 'Deposit'
  | 'Department'
  | 'Employee'
  | 'Estimate'
  | 'Invoice'
  | 'Item'
  | 'JournalEntry'
  | 'Payment'
  | 'PurchaseOrder'
  | 'Purchase'
  | 'RefundReceipt'
  | 'SalesReceipt'
  | 'Transfer'
  | 'Vendor'
  | 'VendorCredit'

interface QuickBooksQueryResponse<T> {
  QueryResponse?: Partial<Record<QuickBooksQueryEntity, T[]>> & {
    startPosition?: number
    maxResults?: number
  }
  time?: string
}

function assertQuickBooksEntity<T>(candidate: unknown, entity: QuickBooksQueryEntity): T {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`QuickBooks ${entity} response contains a malformed ${entity} record`)
  }
  const recordId = (candidate as { Id?: unknown }).Id
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw new Error(`QuickBooks ${entity} response contains a record without an Id`)
  }
  return candidate as T
}

export const QUICKBOOKS_MASTER_DATA_ENTITIES = {
  account: { entity: 'Account', resource: 'account' },
  class: { entity: 'Class', resource: 'class' },
  customer: { entity: 'Customer', resource: 'customer' },
  department: { entity: 'Department', resource: 'department' },
  employee: { entity: 'Employee', resource: 'employee' },
  item: { entity: 'Item', resource: 'item' },
  vendor: { entity: 'Vendor', resource: 'vendor' },
} as const satisfies Record<
  QuickBooksMasterDataRecordType,
  { entity: QuickBooksQueryEntity; resource: string }
>

type QuickBooksReportFilter =
  | 'customerId'
  | 'vendorId'
  | 'accountId'
  | 'itemId'
  | 'classId'
  | 'departmentId'

type QuickBooksReportDateMode = 'range' | 'as_of'

interface QuickBooksReportDefinition {
  endpoint: string
  dateMode: QuickBooksReportDateMode
  accountingMethod: boolean
  summarizeBy: readonly Exclude<QuickBooksReportSummarizeBy, 'default'>[]
  filters: readonly QuickBooksReportFilter[]
  aging: boolean
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
  'profit_and_loss',
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
    filters: ['vendorId', 'departmentId'],
    aging: true,
  },
  ap_aging_summary: {
    endpoint: 'AgedPayables',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['vendorId', 'departmentId'],
    aging: true,
  },
  ar_aging_detail: {
    endpoint: 'AgedReceivableDetail',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'departmentId'],
    aging: true,
  },
  ar_aging_summary: {
    endpoint: 'AgedReceivables',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'departmentId'],
    aging: true,
  },
  balance_sheet: {
    endpoint: 'BalanceSheet',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    aging: false,
  },
  cash_flow: {
    endpoint: 'CashFlow',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'itemId', 'classId', 'departmentId'],
    aging: false,
  },
  customer_balance: {
    endpoint: 'CustomerBalance',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'departmentId'],
    aging: false,
  },
  expenses_by_vendor: {
    endpoint: 'VendorExpenses',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: VENDOR_EXPENSE_SUMMARIES,
    filters: ['customerId', 'vendorId', 'classId', 'departmentId'],
    aging: false,
  },
  profit_and_loss: {
    endpoint: 'ProfitAndLoss',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: ALL_SUMMARIES,
    filters: ['customerId', 'vendorId', 'accountId', 'itemId', 'classId', 'departmentId'],
    aging: false,
  },
  profit_and_loss_detail: {
    endpoint: 'ProfitAndLossDetail',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'accountId', 'classId', 'departmentId'],
    aging: false,
  },
  sales_by_customer: {
    endpoint: 'CustomerSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: CUSTOMER_SALES_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    aging: false,
  },
  sales_by_item: {
    endpoint: 'ItemSales',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: CUSTOMER_SALES_SUMMARIES,
    filters: ['customerId', 'itemId', 'classId', 'departmentId'],
    aging: false,
  },
  trial_balance: {
    endpoint: 'TrialBalance',
    dateMode: 'range',
    accountingMethod: true,
    summarizeBy: TIME_SUMMARIES,
    filters: [],
    aging: false,
  },
  transaction_list: {
    endpoint: 'TransactionList',
    dateMode: 'range',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['customerId', 'vendorId', 'departmentId'],
    aging: false,
  },
  vendor_balance: {
    endpoint: 'VendorBalance',
    dateMode: 'as_of',
    accountingMethod: false,
    summarizeBy: [],
    filters: ['vendorId', 'departmentId'],
    aging: false,
  },
} as const satisfies Record<QuickBooksReportType, QuickBooksReportDefinition>

export type QuickBooksReportControl =
  | 'startDate'
  | 'endDate'
  | 'accountingMethod'
  | 'summarizeBy'
  | QuickBooksReportFilter
  | 'aging'

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
      if (control === 'aging') return definition.aging
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

function addQuickBooksTransactionListFilters(
  url: URL,
  params: QuickBooksRunFinancialReportParams
): void {
  const transactionType = params.transactionType === 'default' ? undefined : params.transactionType
  const groupBy = params.groupBy === 'default' ? undefined : params.groupBy
  const accountsPayablePaid =
    params.accountsPayablePaid === 'default' ? undefined : params.accountsPayablePaid
  const accountsReceivablePaid =
    params.accountsReceivablePaid === 'default' ? undefined : params.accountsReceivablePaid
  const clearedStatus = params.clearedStatus === 'default' ? undefined : params.clearedStatus
  const sourceAccountType =
    params.sourceAccountType === 'default' ? undefined : params.sourceAccountType
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

  if (transactionType) {
    url.searchParams.set(
      'transaction_type',
      QUICKBOOKS_TRANSACTION_LIST_VALUES.transactionType[transactionType]
    )
  }
  if (groupBy) {
    url.searchParams.set('group_by', QUICKBOOKS_TRANSACTION_LIST_VALUES.groupBy[groupBy])
  }
  if (accountsPayablePaid) {
    url.searchParams.set(
      'appaid',
      QUICKBOOKS_TRANSACTION_LIST_VALUES.paidStatus[accountsPayablePaid]
    )
  }
  if (accountsReceivablePaid) {
    url.searchParams.set(
      'arpaid',
      QUICKBOOKS_TRANSACTION_LIST_VALUES.paidStatus[accountsReceivablePaid]
    )
  }
  if (clearedStatus) {
    url.searchParams.set('cleared', QUICKBOOKS_TRANSACTION_LIST_VALUES.clearedStatus[clearedStatus])
  }
  if (controls.docnum) url.searchParams.set('docnum', controls.docnum)
  if (sourceAccountType) {
    url.searchParams.set(
      'source_account_type',
      QUICKBOOKS_TRANSACTION_LIST_VALUES.sourceAccountType[sourceAccountType]
    )
  }
}

export function buildQuickBooksReportUrl(params: QuickBooksRunFinancialReportParams): URL {
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

  const url = buildQuickBooksCompanyUrl(params.realmId, `reports/${definition.endpoint}`)
  if (startDate) url.searchParams.set('start_date', startDate)
  if (endDate) {
    url.searchParams.set(definition.dateMode === 'as_of' ? 'report_date' : 'end_date', endDate)
  }

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
    if (!definition.aging) throw new Error(`${params.reportType} does not support agingMethod`)
    const value = QUICKBOOKS_AGING_METHOD_VALUES[agingMethod]
    if (!value) throw new Error(`Unsupported QuickBooks aging method: ${agingMethod}`)
    url.searchParams.set('aging_method', value)
  }
  if (params.agingDays !== undefined) {
    if (!definition.aging) throw new Error(`${params.reportType} does not support agingDays`)
    if (!Number.isInteger(params.agingDays) || params.agingDays < 1) {
      throw new Error('agingDays must be a positive integer')
    }
    url.searchParams.set('aging_period', String(params.agingDays))
  }

  addQuickBooksTransactionListFilters(url, params)

  return url
}

interface QuickBooksReportEnvelope {
  Header?: QuickBooksReportHeader
  Columns?: QuickBooksReportColumns
  Rows?: QuickBooksReportRows
}

function assertQuickBooksReportSection<T>(value: unknown, section: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`QuickBooks report response is missing or has malformed ${section}`)
  }
  return value as T
}

export async function transformQuickBooksReportResponse(
  response: Response,
  reportType: QuickBooksReportType
): Promise<QuickBooksRunFinancialReportResponse> {
  const data = await parseQuickBooksJson<QuickBooksReportEnvelope>(
    response,
    `QuickBooks ${reportType} report response`
  )
  const header = assertQuickBooksReportSection<QuickBooksReportHeader>(data.Header, 'Header')
  return {
    success: true,
    output: {
      reportType,
      header,
      columns: assertQuickBooksReportSection<QuickBooksReportColumns>(data.Columns, 'Columns'),
      rows: assertQuickBooksReportSection<QuickBooksReportRows>(data.Rows, 'Rows'),
      time: typeof header.Time === 'string' ? header.Time : null,
    },
  }
}

export const QUICKBOOKS_SALES_ENTITIES = {
  credit_memo: { entity: 'CreditMemo', resource: 'creditmemo' },
  estimate: { entity: 'Estimate', resource: 'estimate' },
  invoice: { entity: 'Invoice', resource: 'invoice' },
  payment: { entity: 'Payment', resource: 'payment' },
  refund_receipt: { entity: 'RefundReceipt', resource: 'refundreceipt' },
  sales_receipt: { entity: 'SalesReceipt', resource: 'salesreceipt' },
} as const satisfies Record<
  QuickBooksSalesTransactionType,
  { entity: QuickBooksQueryEntity; resource: string }
>

export function validateQuickBooksPagination(
  startPosition: number,
  maxResults: number
): { startPosition: number; maxResults: number } {
  if (!Number.isInteger(startPosition) || startPosition < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
    throw new Error('maxResults must be an integer from 1 through 100')
  }
  return { startPosition, maxResults }
}

export const QUICKBOOKS_PURCHASING_ENTITIES = {
  bill: { entity: 'Bill', resource: 'bill' },
  bill_payment: { entity: 'BillPayment', resource: 'billpayment' },
  purchase: { entity: 'Purchase', resource: 'purchase' },
  purchase_order: { entity: 'PurchaseOrder', resource: 'purchaseorder' },
  vendor_credit: { entity: 'VendorCredit', resource: 'vendorcredit' },
} as const satisfies Record<
  QuickBooksPurchasingTransactionType,
  { entity: QuickBooksQueryEntity; resource: string }
>

export function buildQuickBooksQueryUrl(
  realmId: string,
  entity: QuickBooksQueryEntity,
  startPosition: number,
  maxResults: number,
  filters: readonly QuickBooksQueryFilter[] = []
): URL {
  const pagination = validateQuickBooksPagination(startPosition, maxResults)
  const url = buildQuickBooksCompanyUrl(realmId, 'query')
  const where =
    filters.length > 0
      ? ` WHERE ${filters.map((filter) => buildQuickBooksQueryFilter(filter)).join(' AND ')}`
      : ''
  url.searchParams.set(
    'query',
    `SELECT * FROM ${entity}${where} STARTPOSITION ${pagination.startPosition} MAXRESULTS ${pagination.maxResults}`
  )
  return url
}

type QuickBooksQueryField = 'Active' | 'CustomerRef' | 'EntityRef' | 'TxnDate' | 'VendorRef'
type QuickBooksQueryOperator = '=' | '>=' | '<='

interface QuickBooksQueryFilter {
  field: QuickBooksQueryField
  operator: QuickBooksQueryOperator
  value: string | boolean
}

function buildQuickBooksQueryFilter(filter: QuickBooksQueryFilter): string {
  if (typeof filter.value === 'boolean') {
    return `${filter.field} ${filter.operator} ${String(filter.value)}`
  }
  const value = requiredQuickBooksString(filter.value, filter.field)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
  return `${filter.field} ${filter.operator} '${value}'`
}

function getQuickBooksDateRangeFilters(
  startDate: string | undefined,
  endDate: string | undefined
): QuickBooksQueryFilter[] {
  const start = validateQuickBooksDate(startDate, 'startDate')
  const end = validateQuickBooksDate(endDate, 'endDate')
  if (start && end && start > end) throw new Error('startDate cannot be after endDate')
  return [
    ...(start ? [{ field: 'TxnDate', operator: '>=', value: start } as const] : []),
    ...(end ? [{ field: 'TxnDate', operator: '<=', value: end } as const] : []),
  ]
}

export function buildQuickBooksMasterDataQueryUrl(params: QuickBooksReadMasterDataParams): URL {
  const config = getQuickBooksMasterDataEntity(params.recordType)
  const activeStatus = params.activeStatus ?? 'default'
  if (!['default', 'active', 'inactive'].includes(activeStatus)) {
    throw new Error(`Unsupported QuickBooks active status filter: ${String(activeStatus)}`)
  }
  const filters: QuickBooksQueryFilter[] =
    activeStatus === 'default'
      ? []
      : [{ field: 'Active', operator: '=', value: activeStatus === 'active' }]
  return buildQuickBooksQueryUrl(
    params.realmId,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    filters
  )
}

export function buildQuickBooksSalesQueryUrl(params: QuickBooksReadSalesTransactionsParams): URL {
  const config = getQuickBooksSalesEntity(params.transactionType)
  const filters = getQuickBooksDateRangeFilters(params.startDate, params.endDate)
  const customerId = optionalQuickBooksString(params.customerId)
  if (customerId) filters.push({ field: 'CustomerRef', operator: '=', value: customerId })
  return buildQuickBooksQueryUrl(
    params.realmId,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    filters
  )
}

const QUICKBOOKS_PURCHASING_VENDOR_FILTER_TYPES = new Set<QuickBooksPurchasingTransactionType>([
  'bill',
  'bill_payment',
  'purchase_order',
  'vendor_credit',
])

export function buildQuickBooksPurchasingQueryUrl(
  params: QuickBooksReadPurchasingTransactionsParams
): URL {
  const config = getQuickBooksPurchasingEntity(params.transactionType)
  const filters = getQuickBooksDateRangeFilters(params.startDate, params.endDate)
  const vendorId = optionalQuickBooksString(params.vendorId)
  if (vendorId) {
    if (!QUICKBOOKS_PURCHASING_VENDOR_FILTER_TYPES.has(params.transactionType)) {
      throw new Error(`${params.transactionType} does not support vendorId filtering`)
    }
    filters.push({ field: 'VendorRef', operator: '=', value: vendorId })
  }
  return buildQuickBooksQueryUrl(
    params.realmId,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    filters
  )
}

export function buildQuickBooksAccountingQueryUrl(
  params: QuickBooksReadAccountingTransactionsParams
): URL {
  const config = getQuickBooksAccountingEntity(params.transactionType)
  return buildQuickBooksQueryUrl(
    params.realmId,
    config.entity,
    params.startPosition ?? 1,
    params.maxResults ?? 25,
    getQuickBooksDateRangeFilters(params.startDate, params.endDate)
  )
}

export function assertQuickBooksListOnlyFilters(
  readMode: 'list' | 'by_id',
  filters: Record<string, unknown>
): void {
  if (readMode !== 'by_id') return
  const provided = Object.entries(filters).find(([, value]) => {
    if (value === undefined || value === null || value === '') return false
    return value !== 'default'
  })
  if (provided) throw new Error(`${provided[0]} is supported only for List mode`)
}

export const QUICKBOOKS_ACCOUNTING_ENTITIES = {
  deposit: { entity: 'Deposit', resource: 'deposit' },
  journal_entry: { entity: 'JournalEntry', resource: 'journalentry' },
  transfer: { entity: 'Transfer', resource: 'transfer' },
} as const satisfies Record<
  QuickBooksAccountingTransactionType,
  { entity: QuickBooksQueryEntity; resource: string }
>

export function getQuickBooksMasterDataEntity(recordType: QuickBooksMasterDataRecordType) {
  const config = QUICKBOOKS_MASTER_DATA_ENTITIES[recordType]
  if (!config) {
    throw new Error(`Unsupported QuickBooks master data record type: ${String(recordType)}`)
  }
  return config
}

export function getQuickBooksSalesEntity(transactionType: QuickBooksSalesTransactionType) {
  const config = QUICKBOOKS_SALES_ENTITIES[transactionType]
  if (!config) {
    throw new Error(`Unsupported QuickBooks sales transaction type: ${String(transactionType)}`)
  }
  return config
}

export function getQuickBooksPurchasingEntity(
  transactionType: QuickBooksPurchasingTransactionType
) {
  const config = QUICKBOOKS_PURCHASING_ENTITIES[transactionType]
  if (!config) {
    throw new Error(
      `Unsupported QuickBooks purchasing transaction type: ${String(transactionType)}`
    )
  }
  return config
}

export function getQuickBooksAccountingEntity(
  transactionType: QuickBooksAccountingTransactionType
) {
  const config = QUICKBOOKS_ACCOUNTING_ENTITIES[transactionType]
  if (!config) {
    throw new Error(
      `Unsupported QuickBooks accounting transaction type: ${String(transactionType)}`
    )
  }
  return config
}

export function buildQuickBooksEntityUrl(
  realmId: string,
  resource: string,
  recordId?: string
): URL {
  const normalizedResource = resource.trim()
  if (!normalizedResource) throw new Error('QuickBooks resource is required')
  const normalizedRecordId = recordId?.trim()
  if (recordId !== undefined && !normalizedRecordId) {
    throw new Error('QuickBooks record ID is required')
  }
  return buildQuickBooksCompanyUrl(
    realmId,
    normalizedRecordId
      ? `${encodeURIComponent(normalizedResource)}/${encodeURIComponent(normalizedRecordId)}`
      : encodeURIComponent(normalizedResource)
  )
}

export function addQuickBooksRequestId(url: URL, requestId?: string): URL {
  const normalized = optionalQuickBooksString(requestId)
  if (!normalized) return url
  if (normalized.length > 50) throw new Error('requestId cannot exceed 50 characters')
  url.searchParams.set('requestid', normalized)
  return url
}

export async function parseQuickBooksJson<T>(
  response: Response,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  if (!response.ok) {
    throw new Error(`QuickBooks request failed with HTTP ${response.status}`)
  }
  const data = await readResponseJsonWithLimit<T>(response, {
    maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
    label,
    signal,
  })
  const faultData = sanitizeQuickBooksFaultData(data)
  if (faultData) {
    const errorInfo = {
      status: response.status,
      statusText: response.statusText,
      data: faultData,
      headers: response.headers,
    }
    throw Object.assign(
      new Error(extractErrorMessage(errorInfo, ErrorExtractorId.QUICKBOOKS_FAULT)),
      errorInfo
    )
  }
  return data
}

export async function transformQuickBooksListResponse<T>(
  response: Response,
  params: QuickBooksPaginationParams,
  entity: QuickBooksQueryEntity
): Promise<QuickBooksListResponse<T>> {
  const data = await parseQuickBooksJson<QuickBooksQueryResponse<T>>(
    response,
    `QuickBooks ${entity} query response`
  )
  const queryResponse = data.QueryResponse
  if (!queryResponse || typeof queryResponse !== 'object' || Array.isArray(queryResponse)) {
    throw new Error(`QuickBooks ${entity} response is missing QueryResponse`)
  }

  const candidate = queryResponse[entity]
  if (candidate !== undefined && !Array.isArray(candidate)) {
    throw new Error(`QuickBooks ${entity} response contains a malformed entity list`)
  }

  const items = (candidate ?? []).map((item) => assertQuickBooksEntity<T>(item, entity))
  const startPosition = Number.isInteger(queryResponse.startPosition)
    ? (queryResponse.startPosition as number)
    : params.startPosition
  const maxResults = Number.isInteger(queryResponse.maxResults)
    ? (queryResponse.maxResults as number)
    : items.length

  return {
    success: true,
    output: {
      items,
      startPosition,
      maxResults,
      nextStartPosition: startPosition + items.length,
      hasMore: items.length === params.maxResults,
      time: typeof data.time === 'string' ? data.time : null,
    },
  }
}

export async function transformQuickBooksEntityResponse<
  T extends { Id: string; SyncToken?: string },
>(
  response: Response,
  entity: QuickBooksQueryEntity,
  signal?: AbortSignal
): Promise<{ item: T; time: string | null }> {
  const data = await parseQuickBooksJson<Record<string, unknown> & { time?: string }>(
    response,
    `QuickBooks ${entity} response`,
    signal
  )
  const candidate = data[entity]
  if (!candidate) {
    throw new Error(`QuickBooks ${entity} response is missing ${entity}`)
  }
  return {
    item: assertQuickBooksEntity<T>(candidate, entity),
    time: typeof data.time === 'string' ? data.time : null,
  }
}

export async function transformQuickBooksMutationResponse<
  T extends { Id: string; SyncToken?: string },
>(
  response: Response,
  entity: QuickBooksQueryEntity,
  sanitize: (item: T) => T = (item) => item,
  signal?: AbortSignal
): Promise<QuickBooksMutationResponse<T>> {
  const parsed = await transformQuickBooksEntityResponse<T>(response, entity, signal)
  const item = sanitize(parsed.item)
  const recordId = typeof item.Id === 'string' ? item.Id.trim() : ''
  const syncToken = typeof item.SyncToken === 'string' ? item.SyncToken.trim() : ''
  if (!recordId || !syncToken) {
    throw new Error(`QuickBooks ${entity} response is missing Id or SyncToken`)
  }
  return {
    success: true,
    output: { record: item, recordId, syncToken, time: parsed.time },
  }
}

export function sanitizeQuickBooksVendor(vendor: QuickBooksVendor): QuickBooksVendor {
  return omit(vendor, ['TaxIdentifier']) as QuickBooksVendor
}

export function sanitizeQuickBooksCustomer(customer: QuickBooksCustomer): QuickBooksCustomer {
  return omit(customer, ['TaxIdentifier']) as QuickBooksCustomer
}

export function sanitizeQuickBooksEmployee(employee: QuickBooksEmployee): QuickBooksEmployee {
  const id = typeof employee.Id === 'string' ? employee.Id.trim() : ''
  if (!id) throw new Error('QuickBooks Employee response is missing Id')

  const sanitized: QuickBooksEmployee = { Id: id }
  for (const key of [
    'SyncToken',
    'DisplayName',
    'GivenName',
    'MiddleName',
    'FamilyName',
    'Suffix',
    'Title',
    'PrintOnCheckName',
  ] as const) {
    const value = employee[key]
    if (typeof value === 'string') sanitized[key] = value
  }
  if (typeof employee.domain === 'string') sanitized.domain = employee.domain
  for (const key of ['Active', 'BillableTime', 'sparse'] as const) {
    const value = employee[key]
    if (typeof value === 'boolean') sanitized[key] = value
  }
  for (const key of ['PrimaryPhone', 'Mobile'] as const) {
    const value = employee[key]
    if (value && typeof value.FreeFormNumber === 'string') {
      sanitized[key] = { FreeFormNumber: value.FreeFormNumber }
    }
  }
  if (employee.PrimaryEmailAddr && typeof employee.PrimaryEmailAddr.Address === 'string') {
    sanitized.PrimaryEmailAddr = { Address: employee.PrimaryEmailAddr.Address }
  }
  if (employee.PrimaryAddr && typeof employee.PrimaryAddr === 'object') {
    const address: QuickBooksAddress = {}
    for (const key of [
      'Id',
      'Line1',
      'Line2',
      'Line3',
      'Line4',
      'Line5',
      'City',
      'Country',
      'CountrySubDivisionCode',
      'PostalCode',
      'Lat',
      'Long',
    ] as const) {
      const value = employee.PrimaryAddr[key]
      if (typeof value === 'string') address[key] = value
    }
    if (Object.keys(address).length > 0) sanitized.PrimaryAddr = address
  }
  if (employee.MetaData && typeof employee.MetaData === 'object') {
    sanitized.MetaData = {
      ...(typeof employee.MetaData.CreateTime === 'string'
        ? { CreateTime: employee.MetaData.CreateTime }
        : {}),
      ...(typeof employee.MetaData.LastUpdatedTime === 'string'
        ? { LastUpdatedTime: employee.MetaData.LastUpdatedTime }
        : {}),
    }
  }
  return sanitized
}

export function quickBooksWritableItemType(itemType: QuickBooksWritableItemType): string {
  const types: Record<QuickBooksWritableItemType, string> = {
    service: 'Service',
    non_inventory: 'NonInventory',
  }
  const type = types[itemType]
  if (!type) throw new Error(`Unsupported writable QuickBooks item type: ${String(itemType)}`)
  return type
}

export function quickBooksReference(value: string, fieldName: string): QuickBooksReference {
  return { value: requiredQuickBooksString(value, fieldName) }
}

export function requiredQuickBooksString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${fieldName} is required`)
  return normalized
}

export function optionalQuickBooksString(value?: string): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized || undefined
}

const QUICKBOOKS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validateQuickBooksDate(
  value: string | undefined,
  fieldName: string
): string | undefined {
  const normalized = optionalQuickBooksString(value)
  if (!normalized) return undefined
  if (!QUICKBOOKS_DATE_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`)
  }
  const date = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${fieldName} must be a valid date`)
  }
  return normalized
}

export function quickBooksEmailAddress(value?: string): { Address: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  return normalized ? { Address: normalized } : undefined
}

export function quickBooksPhoneNumber(value?: string): { FreeFormNumber: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  return normalized ? { FreeFormNumber: normalized } : undefined
}

export function validateQuickBooksOptionalNumber(
  value: number | undefined,
  fieldName: string
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a finite number`)
  return value
}

const QUICKBOOKS_ADDRESS_FIELDS = {
  line1: 'Line1',
  Line1: 'Line1',
  line2: 'Line2',
  Line2: 'Line2',
  city: 'City',
  City: 'City',
  countrySubDivisionCode: 'CountrySubDivisionCode',
  CountrySubDivisionCode: 'CountrySubDivisionCode',
  postalCode: 'PostalCode',
  PostalCode: 'PostalCode',
  country: 'Country',
  Country: 'Country',
} as const

export function parseQuickBooksAddress(
  value: unknown,
  fieldName: string
): QuickBooksAddress | undefined {
  if (value == null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${fieldName} must be valid JSON`)
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }

  const result: QuickBooksAddress = {}
  for (const [key, fieldValue] of Object.entries(parsed)) {
    const quickBooksKey = QUICKBOOKS_ADDRESS_FIELDS[key as keyof typeof QUICKBOOKS_ADDRESS_FIELDS]
    if (!quickBooksKey) {
      throw new Error(`${fieldName} contains unsupported field "${key}"`)
    }
    if (typeof fieldValue !== 'string') {
      throw new Error(`${fieldName}.${key} must be a string`)
    }
    result[quickBooksKey] = fieldValue
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`${fieldName} must contain at least one supported address field`)
  }
  return result
}

export function quickBooksActiveValue(
  activeStatus: QuickBooksActiveStatus | undefined
): boolean | undefined {
  if (activeStatus === undefined || activeStatus === 'unchanged') return undefined
  if (activeStatus === 'active') return true
  if (activeStatus === 'inactive') return false
  throw new Error(`Unsupported QuickBooks active status: ${String(activeStatus)}`)
}

export function assertQuickBooksSparseUpdate(
  body: Record<string, unknown>,
  requiredFieldCount = 3
): void {
  if (Object.keys(body).length <= requiredFieldCount) {
    throw new Error('Provide at least one field to update')
  }
}

export function getQuickBooksToolHeaders(
  accessToken: string,
  contentType?: 'application/json'
): Record<string, string> {
  return {
    ...buildQuickBooksHeaders(accessToken),
    ...(contentType ? { 'Content-Type': contentType } : {}),
  }
}
