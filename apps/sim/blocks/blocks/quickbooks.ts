import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta, OutputCondition } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseQuickBooksDepositLines,
  parseQuickBooksJournalLines,
} from '@/tools/quickbooks/accounting_utils'
import {
  parseQuickBooksBillAllocations,
  parseQuickBooksBillLines,
  parseQuickBooksPurchasingLines,
} from '@/tools/quickbooks/purchasing_utils'
import {
  parseQuickBooksInvoiceAllocations,
  parseQuickBooksSalesLines,
} from '@/tools/quickbooks/sales_utils'
import type { QuickBooksReportType, QuickBooksResponse } from '@/tools/quickbooks/types'
import {
  getQuickBooksReportTypesSupporting,
  parseQuickBooksAddress,
  QUICKBOOKS_REPORT_TYPES_WITH_ALL_SUMMARIES,
  QUICKBOOKS_REPORT_TYPES_WITH_CUSTOMER_SALES_SUMMARIES,
  QUICKBOOKS_REPORT_TYPES_WITH_TIME_SUMMARIES,
  QUICKBOOKS_REPORT_TYPES_WITH_VENDOR_EXPENSE_SUMMARIES,
  type QuickBooksReportControl,
} from '@/tools/quickbooks/utils'

const MASTER_DATA_OPERATION = 'quickbooks_read_master_data'
const SALES_READ_OPERATION = 'quickbooks_read_sales_transactions'
const PURCHASING_READ_OPERATION = 'quickbooks_read_purchasing_transactions'
const ACCOUNTING_READ_OPERATION = 'quickbooks_read_accounting_transactions'
const REPORT_OPERATION = 'quickbooks_run_financial_report'
const CUSTOMER_OPERATIONS = ['quickbooks_create_customer', 'quickbooks_update_customer'] as const
const VENDOR_OPERATIONS = ['quickbooks_create_vendor', 'quickbooks_update_vendor'] as const
const ITEM_OPERATIONS = ['quickbooks_create_item', 'quickbooks_update_item'] as const
const MASTER_DATA_CREATE_OPERATIONS = [
  'quickbooks_create_customer',
  'quickbooks_create_item',
  'quickbooks_create_vendor',
] as const
const SALES_DOCUMENT_CREATE_OPERATIONS = [
  'quickbooks_create_estimate',
  'quickbooks_create_invoice',
  'quickbooks_create_sales_receipt',
  'quickbooks_create_credit_memo',
  'quickbooks_create_refund_receipt',
] as const
const SALES_DOCUMENT_UPDATE_OPERATIONS = [
  'quickbooks_update_estimate',
  'quickbooks_update_invoice',
  'quickbooks_update_sales_receipt',
  'quickbooks_update_credit_memo',
  'quickbooks_update_refund_receipt',
] as const
const SALES_DOCUMENT_OPERATIONS = [
  ...SALES_DOCUMENT_CREATE_OPERATIONS,
  ...SALES_DOCUMENT_UPDATE_OPERATIONS,
] as const
const PAYMENT_OPERATIONS = [
  'quickbooks_create_customer_payment',
  'quickbooks_update_customer_payment',
] as const
const SALES_CREATE_OPERATIONS = [
  ...SALES_DOCUMENT_CREATE_OPERATIONS,
  'quickbooks_create_customer_payment',
] as const
const PURCHASING_CREATE_OPERATIONS = [
  'quickbooks_create_purchase_order',
  'quickbooks_create_bill',
  'quickbooks_create_bill_payment',
  'quickbooks_create_vendor_credit',
  'quickbooks_create_purchase',
] as const
const ACCOUNTING_CREATE_OPERATIONS = [
  'quickbooks_create_journal_entry',
  'quickbooks_create_deposit',
] as const
const CREATE_OPERATIONS = [
  ...MASTER_DATA_CREATE_OPERATIONS,
  ...SALES_CREATE_OPERATIONS,
  ...PURCHASING_CREATE_OPERATIONS,
  ...ACCOUNTING_CREATE_OPERATIONS,
] as const
const SALES_UPDATE_OPERATIONS = [
  ...SALES_DOCUMENT_UPDATE_OPERATIONS,
  'quickbooks_update_customer_payment',
] as const
const SALES_VOID_OPERATIONS = [
  'quickbooks_void_invoice',
  'quickbooks_void_customer_payment',
] as const
const MASTER_DATA_UPDATE_OPERATIONS = [
  'quickbooks_update_customer',
  'quickbooks_update_item',
  'quickbooks_update_vendor',
] as const
const PURCHASING_UPDATE_OPERATIONS = [
  'quickbooks_update_purchase_order',
  'quickbooks_update_bill',
  'quickbooks_update_bill_payment',
  'quickbooks_update_vendor_credit',
  'quickbooks_update_purchase',
] as const
const ACCOUNTING_UPDATE_OPERATIONS = [
  'quickbooks_update_journal_entry',
  'quickbooks_update_deposit',
] as const
const SALES_MUTATION_OPERATIONS = [
  ...SALES_CREATE_OPERATIONS,
  ...SALES_UPDATE_OPERATIONS,
  ...SALES_VOID_OPERATIONS,
] as const
const PURCHASING_MUTATION_OPERATIONS = [
  ...PURCHASING_CREATE_OPERATIONS,
  ...PURCHASING_UPDATE_OPERATIONS,
] as const
const ACCOUNTING_MUTATION_OPERATIONS = [
  ...ACCOUNTING_CREATE_OPERATIONS,
  ...ACCOUNTING_UPDATE_OPERATIONS,
] as const
const UPDATE_OPERATIONS = [
  ...MASTER_DATA_UPDATE_OPERATIONS,
  ...SALES_UPDATE_OPERATIONS,
  ...SALES_VOID_OPERATIONS,
  ...PURCHASING_UPDATE_OPERATIONS,
  ...ACCOUNTING_UPDATE_OPERATIONS,
] as const
const MUTATION_OPERATIONS = [
  ...CUSTOMER_OPERATIONS,
  ...ITEM_OPERATIONS,
  ...VENDOR_OPERATIONS,
  ...SALES_MUTATION_OPERATIONS,
  ...PURCHASING_MUTATION_OPERATIONS,
  ...ACCOUNTING_MUTATION_OPERATIONS,
] as const
const PAGINATED_OPERATIONS = [
  MASTER_DATA_OPERATION,
  SALES_READ_OPERATION,
  PURCHASING_READ_OPERATION,
  ACCOUNTING_READ_OPERATION,
] as const
const LIST_OUTPUT_CONDITION: OutputCondition = {
  field: 'operation',
  value: [
    MASTER_DATA_OPERATION,
    SALES_READ_OPERATION,
    PURCHASING_READ_OPERATION,
    ACCOUNTING_READ_OPERATION,
  ],
  and: { field: 'readMode', value: 'list' },
}
const QUICKBOOKS_OPERATIONS = [
  'quickbooks_get_company_info',
  MASTER_DATA_OPERATION,
  SALES_READ_OPERATION,
  PURCHASING_READ_OPERATION,
  ACCOUNTING_READ_OPERATION,
  REPORT_OPERATION,
  ...MUTATION_OPERATIONS,
] as const

const REPORT_TIME_SUMMARY_OPTIONS = [
  { label: 'QuickBooks Default', id: 'default' },
  { label: 'Total', id: 'total' },
  { label: 'Day', id: 'day' },
  { label: 'Week', id: 'week' },
  { label: 'Month', id: 'month' },
  { label: 'Quarter', id: 'quarter' },
  { label: 'Year', id: 'year' },
] as const

function reportControlCondition(control: QuickBooksReportControl) {
  return {
    field: 'operation',
    value: REPORT_OPERATION,
    and: { field: 'reportType', value: getQuickBooksReportTypesSupporting(control) },
  }
}

function reportSupports(reportType: unknown, control: QuickBooksReportControl): boolean {
  return getQuickBooksReportTypesSupporting(control).includes(reportType as QuickBooksReportType)
}

function reportSummarizeValue(params: Record<string, unknown>, reportType: unknown): unknown {
  if (
    QUICKBOOKS_REPORT_TYPES_WITH_ALL_SUMMARIES.includes(
      reportType as (typeof QUICKBOOKS_REPORT_TYPES_WITH_ALL_SUMMARIES)[number]
    )
  ) {
    return params.reportSummarizeBy ?? 'default'
  }
  if (
    QUICKBOOKS_REPORT_TYPES_WITH_CUSTOMER_SALES_SUMMARIES.includes(
      reportType as (typeof QUICKBOOKS_REPORT_TYPES_WITH_CUSTOMER_SALES_SUMMARIES)[number]
    )
  ) {
    return params.reportCustomerSalesSummarizeBy ?? 'default'
  }
  if (
    QUICKBOOKS_REPORT_TYPES_WITH_VENDOR_EXPENSE_SUMMARIES.includes(
      reportType as (typeof QUICKBOOKS_REPORT_TYPES_WITH_VENDOR_EXPENSE_SUMMARIES)[number]
    )
  ) {
    return params.reportVendorExpenseSummarizeBy ?? 'default'
  }
  if (
    QUICKBOOKS_REPORT_TYPES_WITH_TIME_SUMMARIES.includes(
      reportType as (typeof QUICKBOOKS_REPORT_TYPES_WITH_TIME_SUMMARIES)[number]
    )
  ) {
    return params.reportTimeSummarizeBy ?? 'default'
  }
  return undefined
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`)
  }
  return parsed
}

function parsePaginationInteger(
  value: unknown,
  fieldName: 'startPosition' | 'maxResults',
  fallback: number
): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${fieldName} must be an integer`)
  if (fieldName === 'startPosition' && parsed < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (fieldName === 'maxResults' && (parsed < 1 || parsed > 100)) {
    throw new Error('maxResults must be an integer from 1 through 100')
  }
  return parsed
}

function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} must be a finite number`)
  return parsed
}

function parseTriStateBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value == null || value === '' || value === 'not_specified') return undefined
  if (value === true || value === 'yes') return true
  if (value === false || value === 'no') return false
  throw new Error(`${fieldName} must be not specified, yes, or no`)
}

function optionalValue(value: unknown): unknown {
  if (value == null) return undefined
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

function paginationCondition(values?: Record<string, unknown>) {
  if (!values) {
    return { field: 'operation', value: [...PAGINATED_OPERATIONS] }
  }
  if (values?.operation === MASTER_DATA_OPERATION) {
    return { field: 'readMode', value: 'list' }
  }
  if (values?.operation === SALES_READ_OPERATION) {
    return { field: 'readMode', value: 'list' }
  }
  if (values?.operation === PURCHASING_READ_OPERATION) {
    return { field: 'readMode', value: 'list' }
  }
  if (values?.operation === ACCOUNTING_READ_OPERATION) {
    return { field: 'readMode', value: 'list' }
  }
  return { field: 'operation', value: [] }
}

function salesTransactionIdCondition(values?: Record<string, unknown>) {
  if (!values) {
    return {
      field: 'operation',
      value: [
        SALES_READ_OPERATION,
        PURCHASING_READ_OPERATION,
        ACCOUNTING_READ_OPERATION,
        ...SALES_UPDATE_OPERATIONS,
        ...SALES_VOID_OPERATIONS,
        ...PURCHASING_UPDATE_OPERATIONS,
        ...ACCOUNTING_UPDATE_OPERATIONS,
      ],
    }
  }
  if (
    values?.operation === SALES_READ_OPERATION ||
    values?.operation === PURCHASING_READ_OPERATION ||
    values?.operation === ACCOUNTING_READ_OPERATION
  ) {
    return { field: 'readMode', value: 'by_id' }
  }
  return {
    field: 'operation',
    value: [
      ...SALES_UPDATE_OPERATIONS,
      ...SALES_VOID_OPERATIONS,
      ...PURCHASING_UPDATE_OPERATIONS,
      ...ACCOUNTING_UPDATE_OPERATIONS,
    ],
  }
}

function parseConfirmation(value: unknown, fieldName: string): boolean {
  if (value === true || value === 'yes') return true
  if (value === false || value === 'no' || value == null || value === '') return false
  throw new Error(`${fieldName} must be yes or no`)
}

export const QuickBooksBlock: BlockConfig<QuickBooksResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description:
    'Manage QuickBooks Online company, sales, purchasing, payables, accounting, and reports',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect one QuickBooks Online company to manage bounded master-data, sales, purchasing, receivables, payables, general-accounting, and financial-reporting workflows.',
  docsLink: 'https://docs.sim.ai/integrations/quickbooks',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#2CA01C',
  icon: QuickBooksIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Company Info', id: 'quickbooks_get_company_info' },
        { label: 'Read Master Data', id: 'quickbooks_read_master_data' },
        { label: 'Create Customer', id: 'quickbooks_create_customer' },
        { label: 'Update Customer', id: 'quickbooks_update_customer' },
        { label: 'Create Vendor', id: 'quickbooks_create_vendor' },
        { label: 'Update Vendor', id: 'quickbooks_update_vendor' },
        { label: 'Create Item', id: 'quickbooks_create_item' },
        { label: 'Update Item', id: 'quickbooks_update_item' },
        { label: 'Read Sales Transactions', id: 'quickbooks_read_sales_transactions' },
        { label: 'Create Estimate', id: 'quickbooks_create_estimate' },
        { label: 'Update Estimate', id: 'quickbooks_update_estimate' },
        { label: 'Create Invoice', id: 'quickbooks_create_invoice' },
        { label: 'Update Invoice', id: 'quickbooks_update_invoice' },
        { label: 'Void Invoice', id: 'quickbooks_void_invoice' },
        { label: 'Create Sales Receipt', id: 'quickbooks_create_sales_receipt' },
        { label: 'Update Sales Receipt', id: 'quickbooks_update_sales_receipt' },
        { label: 'Create Customer Payment', id: 'quickbooks_create_customer_payment' },
        { label: 'Update Customer Payment', id: 'quickbooks_update_customer_payment' },
        { label: 'Void Customer Payment', id: 'quickbooks_void_customer_payment' },
        { label: 'Create Credit Memo', id: 'quickbooks_create_credit_memo' },
        { label: 'Update Credit Memo', id: 'quickbooks_update_credit_memo' },
        { label: 'Create Refund Receipt', id: 'quickbooks_create_refund_receipt' },
        { label: 'Update Refund Receipt', id: 'quickbooks_update_refund_receipt' },
        {
          label: 'Read Purchasing Transactions',
          id: 'quickbooks_read_purchasing_transactions',
        },
        { label: 'Create Purchase Order', id: 'quickbooks_create_purchase_order' },
        { label: 'Update Purchase Order', id: 'quickbooks_update_purchase_order' },
        { label: 'Create Bill', id: 'quickbooks_create_bill' },
        { label: 'Update Bill', id: 'quickbooks_update_bill' },
        { label: 'Create Bill Payment', id: 'quickbooks_create_bill_payment' },
        { label: 'Update Bill Payment', id: 'quickbooks_update_bill_payment' },
        { label: 'Create Vendor Credit', id: 'quickbooks_create_vendor_credit' },
        { label: 'Update Vendor Credit', id: 'quickbooks_update_vendor_credit' },
        { label: 'Create Purchase or Expense', id: 'quickbooks_create_purchase' },
        { label: 'Update Purchase or Expense', id: 'quickbooks_update_purchase' },
        {
          label: 'Read Accounting Transactions',
          id: 'quickbooks_read_accounting_transactions',
        },
        { label: 'Create Journal Entry', id: 'quickbooks_create_journal_entry' },
        { label: 'Update Journal Entry', id: 'quickbooks_update_journal_entry' },
        { label: 'Create Deposit', id: 'quickbooks_create_deposit' },
        { label: 'Update Deposit', id: 'quickbooks_update_deposit' },
        { label: 'Run Financial Report', id: 'quickbooks_run_financial_report' },
      ],
      value: () => 'quickbooks_get_company_info',
    },
    {
      id: 'credential',
      title: 'QuickBooks Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'quickbooks',
      requiredScopes: getScopesForService('quickbooks'),
      placeholder: 'Select QuickBooks company',
      required: true,
    },
    {
      id: 'recordType',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'Account', id: 'account' },
        { label: 'Class', id: 'class' },
        { label: 'Customer', id: 'customer' },
        { label: 'Department', id: 'department' },
        { label: 'Vendor', id: 'vendor' },
        { label: 'Item', id: 'item' },
        { label: 'Employee', id: 'employee' },
      ],
      condition: { field: 'operation', value: MASTER_DATA_OPERATION },
      required: { field: 'operation', value: MASTER_DATA_OPERATION },
      value: () => 'account',
    },
    {
      id: 'readMode',
      title: 'Read Mode',
      type: 'dropdown',
      options: [
        { label: 'List', id: 'list' },
        { label: 'By ID', id: 'by_id' },
      ],
      condition: {
        field: 'operation',
        value: [
          MASTER_DATA_OPERATION,
          SALES_READ_OPERATION,
          PURCHASING_READ_OPERATION,
          ACCOUNTING_READ_OPERATION,
        ],
      },
      required: {
        field: 'operation',
        value: [
          MASTER_DATA_OPERATION,
          SALES_READ_OPERATION,
          PURCHASING_READ_OPERATION,
          ACCOUNTING_READ_OPERATION,
        ],
      },
      value: () => 'list',
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'QuickBooks record ID',
      condition: {
        field: 'operation',
        value: MASTER_DATA_OPERATION,
        and: { field: 'readMode', value: 'by_id' },
      },
      required: {
        field: 'operation',
        value: MASTER_DATA_OPERATION,
        and: { field: 'readMode', value: 'by_id' },
      },
    },
    {
      id: 'transactionType',
      title: 'Transaction Type',
      type: 'dropdown',
      options: [
        { label: 'Estimate', id: 'estimate' },
        { label: 'Invoice', id: 'invoice' },
        { label: 'Sales Receipt', id: 'sales_receipt' },
        { label: 'Customer Payment', id: 'payment' },
        { label: 'Credit Memo', id: 'credit_memo' },
        { label: 'Refund Receipt', id: 'refund_receipt' },
      ],
      condition: { field: 'operation', value: SALES_READ_OPERATION },
      required: { field: 'operation', value: SALES_READ_OPERATION },
      value: () => 'invoice',
    },
    {
      id: 'purchasingTransactionType',
      title: 'Transaction Type',
      type: 'dropdown',
      options: [
        { label: 'Purchase Order', id: 'purchase_order' },
        { label: 'Bill', id: 'bill' },
        { label: 'Bill Payment', id: 'bill_payment' },
        { label: 'Vendor Credit', id: 'vendor_credit' },
        { label: 'Purchase/Expense', id: 'purchase' },
      ],
      condition: { field: 'operation', value: PURCHASING_READ_OPERATION },
      required: { field: 'operation', value: PURCHASING_READ_OPERATION },
      value: () => 'bill',
    },
    {
      id: 'accountingTransactionType',
      title: 'Transaction Type',
      type: 'dropdown',
      options: [
        { label: 'Journal Entry', id: 'journal_entry' },
        { label: 'Deposit', id: 'deposit' },
        { label: 'Transfer', id: 'transfer' },
      ],
      condition: { field: 'operation', value: ACCOUNTING_READ_OPERATION },
      required: { field: 'operation', value: ACCOUNTING_READ_OPERATION },
      value: () => 'journal_entry',
    },
    {
      id: 'transactionId',
      title: 'Transaction ID',
      type: 'short-input',
      placeholder: 'QuickBooks transaction ID',
      condition: salesTransactionIdCondition,
      required: salesTransactionIdCondition,
    },
    {
      id: 'reportType',
      title: 'Report Type',
      type: 'dropdown',
      options: [
        { label: 'Balance Sheet', id: 'balance_sheet' },
        { label: 'Profit and Loss', id: 'profit_and_loss' },
        { label: 'Profit and Loss Detail', id: 'profit_and_loss_detail' },
        { label: 'Trial Balance', id: 'trial_balance' },
        { label: 'Statement of Cash Flows', id: 'cash_flow' },
        { label: 'A/P Aging Summary', id: 'ap_aging_summary' },
        { label: 'A/P Aging Detail', id: 'ap_aging_detail' },
        { label: 'A/R Aging Summary', id: 'ar_aging_summary' },
        { label: 'A/R Aging Detail', id: 'ar_aging_detail' },
        { label: 'Vendor Balance Summary', id: 'vendor_balance' },
        { label: 'Customer Balance Summary', id: 'customer_balance' },
        { label: 'Sales by Customer Summary', id: 'sales_by_customer' },
        { label: 'Sales by Product/Service Summary', id: 'sales_by_item' },
        { label: 'Expenses by Vendor', id: 'expenses_by_vendor' },
      ],
      condition: { field: 'operation', value: REPORT_OPERATION },
      required: { field: 'operation', value: REPORT_OPERATION },
      value: () => 'profit_and_loss',
    },
    {
      id: 'reportStartDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      description:
        'Intuit recommends report periods of six months or less for performance, but longer periods remain supported.',
      mode: 'advanced',
      condition: reportControlCondition('startDate'),
    },
    {
      id: 'reportEndDate',
      title: 'End or Report Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      description: 'End date for range reports or as-of date for balance and aging reports.',
      mode: 'advanced',
      condition: reportControlCondition('endDate'),
    },
    {
      id: 'reportAccountingMethod',
      title: 'Accounting Method',
      type: 'dropdown',
      options: [
        { label: 'QuickBooks Default', id: 'default' },
        { label: 'Cash', id: 'cash' },
        { label: 'Accrual', id: 'accrual' },
      ],
      mode: 'advanced',
      condition: reportControlCondition('accountingMethod'),
      value: () => 'default',
    },
    {
      id: 'reportSummarizeBy',
      title: 'Summarize Columns By',
      type: 'dropdown',
      options: [
        ...REPORT_TIME_SUMMARY_OPTIONS,
        { label: 'Customer', id: 'customer' },
        { label: 'Vendor', id: 'vendor' },
        { label: 'Product/Service', id: 'item' },
        { label: 'Class', id: 'class' },
        { label: 'Department', id: 'department' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: REPORT_OPERATION,
        and: { field: 'reportType', value: [...QUICKBOOKS_REPORT_TYPES_WITH_ALL_SUMMARIES] },
      },
      value: () => 'default',
    },
    {
      id: 'reportCustomerSalesSummarizeBy',
      title: 'Summarize Columns By',
      type: 'dropdown',
      options: [
        ...REPORT_TIME_SUMMARY_OPTIONS,
        { label: 'Customer', id: 'customer' },
        { label: 'Product/Service', id: 'item' },
        { label: 'Class', id: 'class' },
        { label: 'Department', id: 'department' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: REPORT_OPERATION,
        and: {
          field: 'reportType',
          value: [...QUICKBOOKS_REPORT_TYPES_WITH_CUSTOMER_SALES_SUMMARIES],
        },
      },
      value: () => 'default',
    },
    {
      id: 'reportVendorExpenseSummarizeBy',
      title: 'Summarize Columns By',
      type: 'dropdown',
      options: [
        ...REPORT_TIME_SUMMARY_OPTIONS,
        { label: 'Customer', id: 'customer' },
        { label: 'Vendor', id: 'vendor' },
        { label: 'Class', id: 'class' },
        { label: 'Department', id: 'department' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: REPORT_OPERATION,
        and: {
          field: 'reportType',
          value: [...QUICKBOOKS_REPORT_TYPES_WITH_VENDOR_EXPENSE_SUMMARIES],
        },
      },
      value: () => 'default',
    },
    {
      id: 'reportTimeSummarizeBy',
      title: 'Summarize Columns By',
      type: 'dropdown',
      options: [...REPORT_TIME_SUMMARY_OPTIONS],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: REPORT_OPERATION,
        and: { field: 'reportType', value: [...QUICKBOOKS_REPORT_TYPES_WITH_TIME_SUMMARIES] },
      },
      value: () => 'default',
    },
    {
      id: 'reportCustomerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'Use Read Master Data to find a customer ID',
      mode: 'advanced',
      condition: reportControlCondition('customerId'),
    },
    {
      id: 'reportVendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'Use Read Master Data to find a vendor ID',
      mode: 'advanced',
      condition: reportControlCondition('vendorId'),
    },
    {
      id: 'reportAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Use Read Master Data to find an account ID',
      mode: 'advanced',
      condition: reportControlCondition('accountId'),
    },
    {
      id: 'reportItemId',
      title: 'Product/Service ID',
      type: 'short-input',
      placeholder: 'Use Read Master Data to find an item ID',
      mode: 'advanced',
      condition: reportControlCondition('itemId'),
    },
    {
      id: 'reportClassId',
      title: 'Class ID',
      type: 'short-input',
      placeholder: 'Use Read Master Data to find a class ID',
      mode: 'advanced',
      condition: reportControlCondition('classId'),
    },
    {
      id: 'reportDepartmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'Use Read Master Data to find a department ID',
      mode: 'advanced',
      condition: reportControlCondition('departmentId'),
    },
    {
      id: 'reportAgingMethod',
      title: 'Aging Method',
      type: 'dropdown',
      options: [
        { label: 'QuickBooks Default', id: 'default' },
        { label: 'Report Date', id: 'report_date' },
        { label: 'Current Date', id: 'current' },
      ],
      mode: 'advanced',
      condition: reportControlCondition('aging'),
      value: () => 'default',
    },
    {
      id: 'reportAgingDays',
      title: 'Days per Aging Period',
      type: 'short-input',
      placeholder: '30',
      mode: 'advanced',
      condition: reportControlCondition('aging'),
    },
    {
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: paginationCondition,
      value: () => '1',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      mode: 'advanced',
      condition: paginationCondition,
      value: () => '25',
    },
    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'QuickBooks customer ID',
      condition: {
        field: 'operation',
        value: ['quickbooks_update_customer', ...SALES_DOCUMENT_OPERATIONS, ...PAYMENT_OPERATIONS],
      },
      required: {
        field: 'operation',
        value: ['quickbooks_update_customer', ...SALES_CREATE_OPERATIONS],
      },
    },
    {
      id: 'vendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'QuickBooks vendor ID',
      condition: {
        field: 'operation',
        value: ['quickbooks_update_vendor', ...PURCHASING_MUTATION_OPERATIONS],
      },
      required: {
        field: 'operation',
        value: [
          'quickbooks_update_vendor',
          'quickbooks_create_purchase_order',
          'quickbooks_create_bill',
          'quickbooks_update_bill',
          'quickbooks_create_bill_payment',
          'quickbooks_update_bill_payment',
          'quickbooks_create_vendor_credit',
          'quickbooks_update_vendor_credit',
        ],
      },
    },
    {
      id: 'itemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'QuickBooks item ID',
      condition: { field: 'operation', value: 'quickbooks_update_item' },
      required: { field: 'operation', value: 'quickbooks_update_item' },
    },
    {
      id: 'syncToken',
      title: 'Sync Token',
      type: 'short-input',
      placeholder: 'Current QuickBooks sync token',
      condition: { field: 'operation', value: [...UPDATE_OPERATIONS] },
      required: { field: 'operation', value: [...UPDATE_OPERATIONS] },
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Unique display name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
      required: {
        field: 'operation',
        value: ['quickbooks_create_customer', 'quickbooks_create_vendor'],
      },
    },
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Company name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'givenName',
      title: 'Given Name',
      type: 'short-input',
      placeholder: 'Given name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'familyName',
      title: 'Family Name',
      type: 'short-input',
      placeholder: 'Family name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'primaryEmail',
      title: 'Primary Email',
      type: 'short-input',
      placeholder: 'name@example.com',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'primaryPhone',
      title: 'Primary Phone',
      type: 'short-input',
      placeholder: 'Phone number',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'billingAddress',
      title: 'Billing Address (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"line1":"123 Main St","city":"San Francisco","countrySubDivisionCode":"CA","postalCode":"94105"}',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks address JSON object using only line1, line2, city, countrySubDivisionCode, postalCode, and country. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'shippingAddress',
      title: 'Shipping Address (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"line1":"123 Main St","city":"San Francisco","countrySubDivisionCode":"CA","postalCode":"94105"}',
      condition: { field: 'operation', value: [...CUSTOMER_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks address JSON object using only line1, line2, city, countrySubDivisionCode, postalCode, and country. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'printOnCheckName',
      title: 'Print on Check Name',
      type: 'short-input',
      placeholder: 'Name printed on checks',
      condition: { field: 'operation', value: [...VENDOR_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'accountNumber',
      title: 'Vendor Account Number',
      type: 'short-input',
      placeholder: 'Account number',
      condition: { field: 'operation', value: [...VENDOR_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'vendor1099',
      title: '1099 Vendor',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: 'not_specified' },
        { label: 'Yes', id: 'yes' },
        { label: 'No', id: 'no' },
      ],
      condition: { field: 'operation', value: [...VENDOR_OPERATIONS] },
      mode: 'advanced',
      value: () => 'not_specified',
    },
    {
      id: 'name',
      title: 'Item Name',
      type: 'short-input',
      placeholder: 'Unique item name',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      required: { field: 'operation', value: 'quickbooks_create_item' },
    },
    {
      id: 'itemType',
      title: 'Item Type',
      type: 'dropdown',
      options: [
        { label: 'Service', id: 'service' },
        { label: 'Non-inventory', id: 'non_inventory' },
      ],
      condition: { field: 'operation', value: 'quickbooks_create_item' },
      required: { field: 'operation', value: 'quickbooks_create_item' },
      value: () => 'service',
    },
    {
      id: 'incomeAccountId',
      title: 'Income Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks income account ID',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      required: { field: 'operation', value: 'quickbooks_create_item' },
    },
    {
      id: 'description',
      title: 'Sales Description',
      type: 'long-input',
      placeholder: 'Item sales description',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
    },
    {
      id: 'unitPrice',
      title: 'Unit Price',
      type: 'short-input',
      placeholder: '0.00',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
    },
    {
      id: 'purchaseDescription',
      title: 'Purchase Description',
      type: 'long-input',
      placeholder: 'Item purchase description',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'purchaseCost',
      title: 'Purchase Cost',
      type: 'short-input',
      placeholder: '0.00',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'expenseAccountId',
      title: 'Expense Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks expense account ID',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'taxable',
      title: 'Taxable',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: 'not_specified' },
        { label: 'Yes', id: 'yes' },
        { label: 'No', id: 'no' },
      ],
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...ITEM_OPERATIONS],
      },
      mode: 'advanced',
      value: () => 'not_specified',
    },
    {
      id: 'activeStatus',
      title: 'Active Status',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: 'unchanged' },
        { label: 'Active', id: 'active' },
        { label: 'Inactive', id: 'inactive' },
      ],
      condition: { field: 'operation', value: [...MASTER_DATA_UPDATE_OPERATIONS] },
      value: () => 'unchanged',
    },
    {
      id: 'lines',
      title: 'Lines (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"lineType":"item","amount":100,"itemId":"7","description":"Consulting"}]',
      condition: { field: 'operation', value: [...SALES_DOCUMENT_OPERATIONS] },
      required: { field: 'operation', value: [...SALES_DOCUMENT_CREATE_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks sales lines. Use item lines with lineType, positive amount, itemId, and optional description, positive quantity, positive unitPrice, and serviceDate. When quantity and unitPrice are both present, amount must equal quantity multiplied by unitPrice. Use description lines with lineType and description. Return ONLY the JSON array - no explanations, no extra text.',
      },
    },
    {
      id: 'purchasingLines',
      title: 'Expense Lines (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"lineType":"account","amount":100,"accountId":"7","description":"Supplies"}]',
      condition: {
        field: 'operation',
        value: [
          'quickbooks_create_purchase_order',
          'quickbooks_create_bill',
          'quickbooks_create_vendor_credit',
          'quickbooks_create_purchase',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'quickbooks_create_purchase_order',
          'quickbooks_create_bill',
          'quickbooks_create_vendor_credit',
          'quickbooks_create_purchase',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks purchasing lines. Use account lines with lineType account, positive amount, accountId, and optional description; or item lines with lineType item, positive amount, itemId, and optional description, positive quantity, and positive unitPrice. When quantity and unitPrice are both present, amount must equal their product. For Create Bill only, a line may include both purchaseOrderId and purchaseOrderLineId to request an explicit Purchase Order line link; always supply both or neither. Return ONLY the JSON array - no explanations, no extra text.',
      },
    },
    {
      id: 'journalLines',
      title: 'Journal Lines (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"postingType":"debit","amount":100,"accountId":"7"},{"postingType":"credit","amount":100,"accountId":"35"}]',
      condition: { field: 'operation', value: 'quickbooks_create_journal_entry' },
      required: { field: 'operation', value: 'quickbooks_create_journal_entry' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a balanced JSON array of QuickBooks journal lines. Each line needs postingType debit or credit, a positive amount, and accountId. Optional fields are description and an entityType/entityId pair. Debits and credits must total the same amount. Return ONLY the JSON array.',
      },
    },
    {
      id: 'depositLines',
      title: 'Deposit Lines (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"amount":100,"accountId":"7","description":"Deposit source"}]',
      condition: { field: 'operation', value: 'quickbooks_create_deposit' },
      required: { field: 'operation', value: 'quickbooks_create_deposit' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks deposit lines. Each line needs a positive amount and accountId, with optional description. Return ONLY the JSON array.',
      },
    },
    {
      id: 'totalAmount',
      title: 'Total Amount',
      type: 'short-input',
      placeholder: '100.00',
      condition: {
        field: 'operation',
        value: [...PAYMENT_OPERATIONS, 'quickbooks_create_bill_payment'],
      },
      required: {
        field: 'operation',
        value: ['quickbooks_create_customer_payment', 'quickbooks_create_bill_payment'],
      },
    },
    {
      id: 'apAccountId',
      title: 'Accounts Payable Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks A/P account ID',
      condition: {
        field: 'operation',
        value: [
          'quickbooks_create_purchase_order',
          'quickbooks_update_purchase_order',
          'quickbooks_create_bill',
          'quickbooks_update_bill',
          'quickbooks_create_vendor_credit',
          'quickbooks_update_vendor_credit',
        ],
      },
      required: { field: 'operation', value: 'quickbooks_create_purchase_order' },
    },
    {
      id: 'billPaymentType',
      title: 'Payment Type',
      type: 'dropdown',
      options: [
        { label: 'Check', id: 'check' },
        { label: 'Credit Card', id: 'credit_card' },
      ],
      condition: { field: 'operation', value: 'quickbooks_create_bill_payment' },
      required: { field: 'operation', value: 'quickbooks_create_bill_payment' },
      value: () => 'check',
    },
    {
      id: 'purchasePaymentType',
      title: 'Payment Type',
      type: 'dropdown',
      options: [
        { label: 'Cash', id: 'cash' },
        { label: 'Check', id: 'check' },
        { label: 'Credit Card', id: 'credit_card' },
      ],
      condition: { field: 'operation', value: 'quickbooks_create_purchase' },
      required: { field: 'operation', value: 'quickbooks_create_purchase' },
      value: () => 'cash',
    },
    {
      id: 'currentPurchasePaymentType',
      title: 'Current Payment Type',
      type: 'dropdown',
      options: [
        { label: 'Cash', id: 'cash' },
        { label: 'Check', id: 'check' },
        { label: 'Credit Card', id: 'credit_card' },
      ],
      condition: { field: 'operation', value: 'quickbooks_update_purchase' },
      required: { field: 'operation', value: 'quickbooks_update_purchase' },
    },
    {
      id: 'paymentAccountId',
      title: 'Payment Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks bank or credit-card account ID',
      condition: {
        field: 'operation',
        value: ['quickbooks_create_bill_payment', 'quickbooks_create_purchase'],
      },
      required: {
        field: 'operation',
        value: ['quickbooks_create_bill_payment', 'quickbooks_create_purchase'],
      },
    },
    {
      id: 'billAllocations',
      title: 'Bill Allocations (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"billId":"123","amount":75}]',
      condition: { field: 'operation', value: 'quickbooks_create_bill_payment' },
      required: { field: 'operation', value: 'quickbooks_create_bill_payment' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks Bill allocations using only billId and a positive amount. Allocation amounts must total the payment amount. Return ONLY the JSON array - no explanations, no extra text.',
      },
    },
    {
      id: 'transactionDate',
      title: 'Transaction Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: [
          ...SALES_CREATE_OPERATIONS,
          ...SALES_UPDATE_OPERATIONS,
          ...PURCHASING_MUTATION_OPERATIONS,
          ...ACCOUNTING_MUTATION_OPERATIONS,
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: [
          'quickbooks_create_invoice',
          'quickbooks_update_invoice',
          'quickbooks_create_bill',
          'quickbooks_update_bill',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'expirationDate',
      title: 'Expiration Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['quickbooks_create_estimate', 'quickbooks_update_estimate'],
      },
      mode: 'advanced',
    },
    {
      id: 'documentNumber',
      title: 'Document Number',
      type: 'short-input',
      placeholder: 'Optional QuickBooks document number',
      condition: {
        field: 'operation',
        value: [
          ...SALES_DOCUMENT_OPERATIONS,
          'quickbooks_create_purchase_order',
          'quickbooks_update_purchase_order',
          'quickbooks_create_bill',
          'quickbooks_update_bill',
          'quickbooks_create_vendor_credit',
          'quickbooks_update_vendor_credit',
          'quickbooks_create_journal_entry',
          'quickbooks_update_journal_entry',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'privateNote',
      title: 'Private Note',
      type: 'long-input',
      placeholder: 'Internal note',
      condition: {
        field: 'operation',
        value: [
          ...SALES_CREATE_OPERATIONS,
          ...SALES_UPDATE_OPERATIONS,
          ...PURCHASING_MUTATION_OPERATIONS,
          ...ACCOUNTING_MUTATION_OPERATIONS,
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'customerMemo',
      title: 'Customer Memo',
      type: 'long-input',
      placeholder: 'Customer-facing memo',
      condition: { field: 'operation', value: [...SALES_DOCUMENT_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'paymentMethodId',
      title: 'Payment Method ID',
      type: 'short-input',
      placeholder: 'QuickBooks payment method ID',
      condition: {
        field: 'operation',
        value: [
          'quickbooks_create_sales_receipt',
          'quickbooks_update_sales_receipt',
          'quickbooks_create_refund_receipt',
          'quickbooks_update_refund_receipt',
          ...PAYMENT_OPERATIONS,
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'paymentReferenceNumber',
      title: 'Payment Reference Number',
      type: 'short-input',
      placeholder: 'Check or payment reference',
      condition: {
        field: 'operation',
        value: [
          'quickbooks_create_sales_receipt',
          'quickbooks_update_sales_receipt',
          'quickbooks_create_refund_receipt',
          'quickbooks_update_refund_receipt',
          ...PAYMENT_OPERATIONS,
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'depositAccountId',
      title: 'Deposit Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks deposit account ID',
      condition: {
        field: 'operation',
        value: [
          'quickbooks_create_sales_receipt',
          'quickbooks_update_sales_receipt',
          'quickbooks_create_refund_receipt',
          'quickbooks_update_refund_receipt',
          ...PAYMENT_OPERATIONS,
          'quickbooks_create_deposit',
          'quickbooks_update_deposit',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'quickbooks_create_refund_receipt',
          'quickbooks_create_deposit',
          'quickbooks_update_deposit',
        ],
      },
    },
    {
      id: 'invoiceAllocations',
      title: 'Invoice Allocations (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"invoiceId":"42","amount":75}]',
      condition: { field: 'operation', value: [...PAYMENT_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks invoice allocations using only invoiceId and a positive amount. Return ONLY the JSON array - no explanations, no extra text.',
      },
    },
    {
      id: 'paymentReference',
      title: 'Payment Reference',
      type: 'short-input',
      placeholder: 'Optional check or payment reference',
      condition: {
        field: 'operation',
        value: ['quickbooks_create_purchase', 'quickbooks_update_purchase'],
      },
      mode: 'advanced',
    },
    {
      id: 'requestId',
      title: 'Request ID',
      type: 'short-input',
      placeholder: 'Optional idempotency key (max 50 characters)',
      condition: { field: 'operation', value: [...CREATE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'confirmVoid',
      title: 'Confirm Void',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'no' },
        { label: 'Yes', id: 'yes' },
      ],
      condition: { field: 'operation', value: [...SALES_VOID_OPERATIONS] },
      required: { field: 'operation', value: [...SALES_VOID_OPERATIONS] },
      value: () => 'no',
    },
    {
      id: 'confirmPosting',
      title: 'Confirm Posting',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'no' },
        { label: 'Yes', id: 'yes' },
      ],
      condition: {
        field: 'operation',
        value: ['quickbooks_create_journal_entry', 'quickbooks_update_journal_entry'],
      },
      required: {
        field: 'operation',
        value: ['quickbooks_create_journal_entry', 'quickbooks_update_journal_entry'],
      },
      value: () => 'no',
    },
  ],
  tools: {
    access: [
      'quickbooks_get_company_info',
      'quickbooks_read_master_data',
      'quickbooks_create_customer',
      'quickbooks_update_customer',
      'quickbooks_create_vendor',
      'quickbooks_update_vendor',
      'quickbooks_create_item',
      'quickbooks_update_item',
      'quickbooks_read_sales_transactions',
      'quickbooks_create_estimate',
      'quickbooks_update_estimate',
      'quickbooks_create_invoice',
      'quickbooks_update_invoice',
      'quickbooks_void_invoice',
      'quickbooks_create_sales_receipt',
      'quickbooks_update_sales_receipt',
      'quickbooks_create_customer_payment',
      'quickbooks_update_customer_payment',
      'quickbooks_void_customer_payment',
      'quickbooks_create_credit_memo',
      'quickbooks_update_credit_memo',
      'quickbooks_create_refund_receipt',
      'quickbooks_update_refund_receipt',
      'quickbooks_read_purchasing_transactions',
      'quickbooks_create_purchase_order',
      'quickbooks_update_purchase_order',
      'quickbooks_create_bill',
      'quickbooks_update_bill',
      'quickbooks_create_bill_payment',
      'quickbooks_update_bill_payment',
      'quickbooks_create_vendor_credit',
      'quickbooks_update_vendor_credit',
      'quickbooks_create_purchase',
      'quickbooks_update_purchase',
      'quickbooks_read_accounting_transactions',
      'quickbooks_create_journal_entry',
      'quickbooks_update_journal_entry',
      'quickbooks_create_deposit',
      'quickbooks_update_deposit',
      'quickbooks_run_financial_report',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation)
        if (!QUICKBOOKS_OPERATIONS.includes(operation as (typeof QUICKBOOKS_OPERATIONS)[number])) {
          throw new Error(`Unknown QuickBooks operation: ${operation}`)
        }
        return operation
      },
      params: (params) => {
        const operation = String(params.operation)
        const oauthCredentialValue = params.oauthCredential

        if (operation === MASTER_DATA_OPERATION) {
          if (params.readMode === 'by_id') {
            return {
              credential: oauthCredentialValue,
              recordType: params.recordType,
              readMode: params.readMode,
              recordId: optionalValue(params.recordId),
            }
          }
          return {
            credential: oauthCredentialValue,
            recordType: params.recordType,
            readMode: params.readMode,
            startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
            maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
          }
        }
        if (operation === SALES_READ_OPERATION) {
          if (params.readMode === 'by_id') {
            return {
              credential: oauthCredentialValue,
              transactionType: params.transactionType,
              readMode: params.readMode,
              transactionId: optionalValue(params.transactionId),
            }
          }
          return {
            credential: oauthCredentialValue,
            transactionType: params.transactionType,
            readMode: params.readMode,
            startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
            maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
          }
        }
        if (operation === PURCHASING_READ_OPERATION) {
          if (params.readMode === 'by_id') {
            return {
              credential: oauthCredentialValue,
              transactionType: params.purchasingTransactionType,
              readMode: params.readMode,
              transactionId: optionalValue(params.transactionId),
            }
          }
          return {
            credential: oauthCredentialValue,
            transactionType: params.purchasingTransactionType,
            readMode: params.readMode,
            startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
            maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
          }
        }
        if (operation === ACCOUNTING_READ_OPERATION) {
          if (params.readMode === 'by_id') {
            return {
              credential: oauthCredentialValue,
              transactionType: params.accountingTransactionType,
              readMode: params.readMode,
              transactionId: optionalValue(params.transactionId),
            }
          }
          return {
            credential: oauthCredentialValue,
            transactionType: params.accountingTransactionType,
            readMode: params.readMode,
            startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
            maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
          }
        }
        if (operation === REPORT_OPERATION) {
          const reportType = params.reportType
          return {
            credential: oauthCredentialValue,
            reportType,
            startDate: reportSupports(reportType, 'startDate')
              ? optionalValue(params.reportStartDate)
              : undefined,
            endDate: optionalValue(params.reportEndDate),
            accountingMethod: reportSupports(reportType, 'accountingMethod')
              ? (params.reportAccountingMethod ?? 'default')
              : undefined,
            summarizeBy: reportSupports(reportType, 'summarizeBy')
              ? reportSummarizeValue(params, reportType)
              : undefined,
            customerId: reportSupports(reportType, 'customerId')
              ? optionalValue(params.reportCustomerId)
              : undefined,
            vendorId: reportSupports(reportType, 'vendorId')
              ? optionalValue(params.reportVendorId)
              : undefined,
            accountId: reportSupports(reportType, 'accountId')
              ? optionalValue(params.reportAccountId)
              : undefined,
            itemId: reportSupports(reportType, 'itemId')
              ? optionalValue(params.reportItemId)
              : undefined,
            classId: reportSupports(reportType, 'classId')
              ? optionalValue(params.reportClassId)
              : undefined,
            departmentId: reportSupports(reportType, 'departmentId')
              ? optionalValue(params.reportDepartmentId)
              : undefined,
            agingMethod: reportSupports(reportType, 'aging')
              ? (params.reportAgingMethod ?? 'default')
              : undefined,
            agingDays: reportSupports(reportType, 'aging')
              ? parseOptionalPositiveInteger(params.reportAgingDays, 'agingDays')
              : undefined,
          }
        }
        if (SALES_VOID_OPERATIONS.includes(operation as (typeof SALES_VOID_OPERATIONS)[number])) {
          return {
            credential: oauthCredentialValue,
            transactionId: optionalValue(params.transactionId),
            syncToken: optionalValue(params.syncToken),
            confirmVoid: parseConfirmation(params.confirmVoid, 'confirmVoid'),
          }
        }
        if (
          SALES_DOCUMENT_OPERATIONS.includes(
            operation as (typeof SALES_DOCUMENT_OPERATIONS)[number]
          )
        ) {
          const isCreate = SALES_DOCUMENT_CREATE_OPERATIONS.includes(
            operation as (typeof SALES_DOCUMENT_CREATE_OPERATIONS)[number]
          )
          const isInvoice =
            operation === 'quickbooks_create_invoice' || operation === 'quickbooks_update_invoice'
          const isEstimate =
            operation === 'quickbooks_create_estimate' || operation === 'quickbooks_update_estimate'
          const isReceipt =
            operation === 'quickbooks_create_sales_receipt' ||
            operation === 'quickbooks_update_sales_receipt' ||
            operation === 'quickbooks_create_refund_receipt' ||
            operation === 'quickbooks_update_refund_receipt'
          return {
            credential: oauthCredentialValue,
            transactionId: isCreate ? undefined : optionalValue(params.transactionId),
            syncToken: isCreate ? undefined : optionalValue(params.syncToken),
            customerId: optionalValue(params.customerId),
            lines: parseQuickBooksSalesLines(params.lines),
            transactionDate: optionalValue(params.transactionDate),
            dueDate: isInvoice ? optionalValue(params.dueDate) : undefined,
            expirationDate: isEstimate ? optionalValue(params.expirationDate) : undefined,
            documentNumber: optionalValue(params.documentNumber),
            privateNote: optionalValue(params.privateNote),
            customerMemo: optionalValue(params.customerMemo),
            paymentMethodId: isReceipt ? optionalValue(params.paymentMethodId) : undefined,
            paymentReferenceNumber: isReceipt
              ? optionalValue(params.paymentReferenceNumber)
              : undefined,
            depositAccountId: isReceipt ? optionalValue(params.depositAccountId) : undefined,
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        if (PAYMENT_OPERATIONS.includes(operation as (typeof PAYMENT_OPERATIONS)[number])) {
          const isCreate = operation === 'quickbooks_create_customer_payment'
          return {
            credential: oauthCredentialValue,
            paymentId: isCreate ? undefined : optionalValue(params.transactionId),
            syncToken: isCreate ? undefined : optionalValue(params.syncToken),
            customerId: optionalValue(params.customerId),
            totalAmount: parseOptionalNumber(params.totalAmount, 'totalAmount'),
            transactionDate: optionalValue(params.transactionDate),
            privateNote: optionalValue(params.privateNote),
            paymentReferenceNumber: optionalValue(params.paymentReferenceNumber),
            paymentMethodId: optionalValue(params.paymentMethodId),
            depositAccountId: optionalValue(params.depositAccountId),
            invoiceAllocations: parseQuickBooksInvoiceAllocations(params.invoiceAllocations),
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        if (
          PURCHASING_MUTATION_OPERATIONS.includes(
            operation as (typeof PURCHASING_MUTATION_OPERATIONS)[number]
          )
        ) {
          const isCreate = PURCHASING_CREATE_OPERATIONS.includes(
            operation as (typeof PURCHASING_CREATE_OPERATIONS)[number]
          )
          const isPurchaseOrder =
            operation === 'quickbooks_create_purchase_order' ||
            operation === 'quickbooks_update_purchase_order'
          const isBill =
            operation === 'quickbooks_create_bill' || operation === 'quickbooks_update_bill'
          const isBillPayment =
            operation === 'quickbooks_create_bill_payment' ||
            operation === 'quickbooks_update_bill_payment'
          const isVendorCredit =
            operation === 'quickbooks_create_vendor_credit' ||
            operation === 'quickbooks_update_vendor_credit'
          const isPurchase =
            operation === 'quickbooks_create_purchase' || operation === 'quickbooks_update_purchase'
          return {
            credential: oauthCredentialValue,
            purchaseOrderId:
              !isCreate && isPurchaseOrder ? optionalValue(params.transactionId) : undefined,
            billId: !isCreate && isBill ? optionalValue(params.transactionId) : undefined,
            billPaymentId:
              !isCreate && isBillPayment ? optionalValue(params.transactionId) : undefined,
            vendorCreditId:
              !isCreate && isVendorCredit ? optionalValue(params.transactionId) : undefined,
            purchaseId: !isCreate && isPurchase ? optionalValue(params.transactionId) : undefined,
            syncToken: isCreate ? undefined : optionalValue(params.syncToken),
            vendorId: optionalValue(params.vendorId),
            apAccountId:
              isPurchaseOrder || isBill || isVendorCredit
                ? optionalValue(params.apAccountId)
                : undefined,
            lines:
              isCreate && (isPurchaseOrder || isBill || isVendorCredit || isPurchase)
                ? isBill
                  ? parseQuickBooksBillLines(params.purchasingLines)
                  : parseQuickBooksPurchasingLines(params.purchasingLines)
                : undefined,
            totalAmount:
              isCreate && isBillPayment
                ? parseOptionalNumber(params.totalAmount, 'totalAmount')
                : undefined,
            paymentType:
              isCreate && isBillPayment
                ? optionalValue(params.billPaymentType)
                : isCreate && isPurchase
                  ? optionalValue(params.purchasePaymentType)
                  : undefined,
            currentPaymentType:
              !isCreate && isPurchase
                ? optionalValue(params.currentPurchasePaymentType)
                : undefined,
            paymentAccountId:
              isCreate && (isBillPayment || isPurchase)
                ? optionalValue(params.paymentAccountId)
                : undefined,
            billAllocations:
              isCreate && isBillPayment
                ? parseQuickBooksBillAllocations(params.billAllocations)
                : undefined,
            transactionDate: optionalValue(params.transactionDate),
            dueDate: isBill ? optionalValue(params.dueDate) : undefined,
            documentNumber:
              isPurchaseOrder || isBill || isVendorCredit
                ? optionalValue(params.documentNumber)
                : undefined,
            paymentReference: isPurchase ? optionalValue(params.paymentReference) : undefined,
            privateNote: optionalValue(params.privateNote),
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        if (
          ACCOUNTING_MUTATION_OPERATIONS.includes(
            operation as (typeof ACCOUNTING_MUTATION_OPERATIONS)[number]
          )
        ) {
          const isJournalEntry =
            operation === 'quickbooks_create_journal_entry' ||
            operation === 'quickbooks_update_journal_entry'
          const isCreate = ACCOUNTING_CREATE_OPERATIONS.includes(
            operation as (typeof ACCOUNTING_CREATE_OPERATIONS)[number]
          )
          return {
            credential: oauthCredentialValue,
            journalEntryId:
              !isCreate && isJournalEntry ? optionalValue(params.transactionId) : undefined,
            depositId:
              !isCreate && !isJournalEntry ? optionalValue(params.transactionId) : undefined,
            syncToken: isCreate ? undefined : optionalValue(params.syncToken),
            lines:
              isCreate && isJournalEntry
                ? parseQuickBooksJournalLines(params.journalLines)
                : isCreate
                  ? parseQuickBooksDepositLines(params.depositLines)
                  : undefined,
            confirmPosting: isJournalEntry
              ? parseConfirmation(params.confirmPosting, 'confirmPosting')
              : undefined,
            depositAccountId: !isJournalEntry ? optionalValue(params.depositAccountId) : undefined,
            transactionDate: optionalValue(params.transactionDate),
            documentNumber: isJournalEntry ? optionalValue(params.documentNumber) : undefined,
            privateNote: optionalValue(params.privateNote),
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        if (
          operation === 'quickbooks_create_customer' ||
          operation === 'quickbooks_update_customer'
        ) {
          const isCreate = operation === 'quickbooks_create_customer'
          return {
            credential: oauthCredentialValue,
            customerId: optionalValue(params.customerId),
            syncToken: optionalValue(params.syncToken),
            displayName: optionalValue(params.displayName),
            companyName: optionalValue(params.companyName),
            givenName: optionalValue(params.givenName),
            familyName: optionalValue(params.familyName),
            primaryEmail: optionalValue(params.primaryEmail),
            primaryPhone: optionalValue(params.primaryPhone),
            billingAddress: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
            shippingAddress: parseQuickBooksAddress(params.shippingAddress, 'shippingAddress'),
            taxable: parseTriStateBoolean(params.taxable, 'taxable'),
            activeStatus: params.activeStatus ?? 'unchanged',
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        if (operation === 'quickbooks_create_vendor' || operation === 'quickbooks_update_vendor') {
          const isCreate = operation === 'quickbooks_create_vendor'
          return {
            credential: oauthCredentialValue,
            vendorId: optionalValue(params.vendorId),
            syncToken: optionalValue(params.syncToken),
            displayName: optionalValue(params.displayName),
            companyName: optionalValue(params.companyName),
            givenName: optionalValue(params.givenName),
            familyName: optionalValue(params.familyName),
            primaryEmail: optionalValue(params.primaryEmail),
            primaryPhone: optionalValue(params.primaryPhone),
            billingAddress: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
            printOnCheckName: optionalValue(params.printOnCheckName),
            accountNumber: optionalValue(params.accountNumber),
            vendor1099: parseTriStateBoolean(params.vendor1099, 'vendor1099'),
            activeStatus: params.activeStatus ?? 'unchanged',
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        if (operation === 'quickbooks_create_item' || operation === 'quickbooks_update_item') {
          const isCreate = operation === 'quickbooks_create_item'
          return {
            credential: oauthCredentialValue,
            itemId: optionalValue(params.itemId),
            syncToken: optionalValue(params.syncToken),
            name: optionalValue(params.name),
            itemType:
              operation === 'quickbooks_create_item' ? optionalValue(params.itemType) : undefined,
            incomeAccountId: optionalValue(params.incomeAccountId),
            description: optionalValue(params.description),
            unitPrice: parseOptionalNumber(params.unitPrice, 'unitPrice'),
            purchaseDescription: optionalValue(params.purchaseDescription),
            purchaseCost: parseOptionalNumber(params.purchaseCost, 'purchaseCost'),
            expenseAccountId: optionalValue(params.expenseAccountId),
            taxable: parseTriStateBoolean(params.taxable, 'taxable'),
            activeStatus: params.activeStatus ?? 'unchanged',
            requestId: isCreate ? optionalValue(params.requestId) : undefined,
          }
        }
        return { credential: oauthCredentialValue }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'QuickBooks operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'OAuth credential bound to one QuickBooks company',
    },
    recordType: { type: 'string', description: 'Master-data entity type' },
    readMode: { type: 'string', description: 'List or by-ID read mode' },
    recordId: { type: 'string', description: 'Master-data record ID' },
    transactionType: { type: 'string', description: 'Sales transaction entity type' },
    purchasingTransactionType: {
      type: 'string',
      description: 'Purchasing transaction entity type',
    },
    accountingTransactionType: {
      type: 'string',
      description: 'Accounting transaction entity type',
    },
    reportType: { type: 'string', description: 'Financial report type' },
    reportStartDate: { type: 'string', description: 'Report start date' },
    reportEndDate: { type: 'string', description: 'Report end or as-of date' },
    reportAccountingMethod: { type: 'string', description: 'Cash or accrual report basis' },
    reportSummarizeBy: { type: 'string', description: 'Report column summarization' },
    reportCustomerSalesSummarizeBy: {
      type: 'string',
      description: 'Sales report column summarization',
    },
    reportVendorExpenseSummarizeBy: {
      type: 'string',
      description: 'Vendor expense report column summarization',
    },
    reportTimeSummarizeBy: {
      type: 'string',
      description: 'Time-based report column summarization',
    },
    reportCustomerId: { type: 'string', description: 'Customer report filter ID' },
    reportVendorId: { type: 'string', description: 'Vendor report filter ID' },
    reportAccountId: { type: 'string', description: 'Account report filter ID' },
    reportItemId: { type: 'string', description: 'Product or service report filter ID' },
    reportClassId: { type: 'string', description: 'Class report filter ID' },
    reportDepartmentId: { type: 'string', description: 'Department report filter ID' },
    reportAgingMethod: { type: 'string', description: 'Aging report calculation date' },
    reportAgingDays: { type: 'number', description: 'Days in each aging period' },
    transactionId: { type: 'string', description: 'QuickBooks transaction ID' },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first list item to request',
    },
    maxResults: {
      type: 'number',
      description: 'Number of list items to request, from 1 through 100',
    },
    customerId: { type: 'string', description: 'QuickBooks customer ID' },
    vendorId: { type: 'string', description: 'QuickBooks vendor ID' },
    itemId: { type: 'string', description: 'Item ID for an update' },
    syncToken: { type: 'string', description: 'Current entity sync token' },
    displayName: { type: 'string', description: 'Customer or vendor display name' },
    companyName: { type: 'string', description: 'Customer or vendor company name' },
    givenName: { type: 'string', description: 'Customer or vendor given name' },
    familyName: { type: 'string', description: 'Customer or vendor family name' },
    primaryEmail: { type: 'string', description: 'Primary email address' },
    primaryPhone: { type: 'string', description: 'Primary phone number' },
    billingAddress: { type: 'json', description: 'Allowlisted billing address object' },
    shippingAddress: { type: 'json', description: 'Allowlisted shipping address object' },
    taxable: { type: 'boolean', description: 'Optional taxable value' },
    printOnCheckName: { type: 'string', description: 'Vendor name printed on checks' },
    accountNumber: { type: 'string', description: 'Vendor account number' },
    vendor1099: { type: 'boolean', description: 'Optional vendor 1099 value' },
    name: { type: 'string', description: 'Item name' },
    itemType: { type: 'string', description: 'Service or Non-inventory item type' },
    incomeAccountId: { type: 'string', description: 'Item income account ID' },
    description: { type: 'string', description: 'Item sales description' },
    unitPrice: { type: 'number', description: 'Item sales price' },
    purchaseDescription: { type: 'string', description: 'Item purchase description' },
    purchaseCost: { type: 'number', description: 'Item purchase cost' },
    expenseAccountId: { type: 'string', description: 'Item expense account ID' },
    activeStatus: { type: 'string', description: 'Entity active-status change' },
    lines: { type: 'json', description: 'Bounded item and description sales lines' },
    purchasingLines: {
      type: 'json',
      description:
        'Bounded purchasing expense lines; Create Bill lines may include paired Purchase Order and line IDs',
    },
    journalLines: { type: 'json', description: 'Bounded balanced journal-entry lines' },
    depositLines: { type: 'json', description: 'Bounded account-based deposit lines' },
    totalAmount: { type: 'number', description: 'Customer or Bill payment total' },
    apAccountId: { type: 'string', description: 'QuickBooks accounts-payable account ID' },
    billPaymentType: { type: 'string', description: 'Check or credit-card BillPayment type' },
    purchasePaymentType: {
      type: 'string',
      description: 'Cash, check, or credit-card Purchase type',
    },
    currentPurchasePaymentType: {
      type: 'string',
      description: 'Current Purchase type required unchanged for a sparse update',
    },
    paymentAccountId: { type: 'string', description: 'QuickBooks payment account ID' },
    billAllocations: { type: 'json', description: 'Bounded BillPayment allocations to Bills' },
    transactionDate: { type: 'string', description: 'Transaction date in YYYY-MM-DD format' },
    dueDate: { type: 'string', description: 'Invoice due date in YYYY-MM-DD format' },
    expirationDate: {
      type: 'string',
      description: 'Estimate expiration date in YYYY-MM-DD format',
    },
    documentNumber: { type: 'string', description: 'QuickBooks document number' },
    privateNote: { type: 'string', description: 'Internal transaction note' },
    customerMemo: { type: 'string', description: 'Customer-facing transaction memo' },
    paymentMethodId: { type: 'string', description: 'QuickBooks payment method ID' },
    paymentReferenceNumber: { type: 'string', description: 'Payment reference number' },
    paymentReference: { type: 'string', description: 'Purchase payment reference number' },
    depositAccountId: { type: 'string', description: 'QuickBooks deposit account ID' },
    invoiceAllocations: {
      type: 'json',
      description: 'Bounded customer-payment allocations to invoices',
    },
    requestId: { type: 'string', description: 'Optional Intuit idempotency request ID' },
    confirmVoid: { type: 'boolean', description: 'Explicit confirmation for a void operation' },
    confirmPosting: {
      type: 'boolean',
      description: 'Explicit confirmation before posting a journal entry',
    },
  },
  outputs: {
    company: {
      type: 'json',
      description:
        'CompanyInfo with Id, CompanyName, LegalName, addresses, contact details, company settings, and MetaData',
      condition: { field: 'operation', value: 'quickbooks_get_company_info' },
    },
    recordType: {
      type: 'string',
      description: 'Master-data record type returned by the read',
      condition: { field: 'operation', value: MASTER_DATA_OPERATION },
    },
    transactionType: {
      type: 'string',
      description: 'Sales, purchasing, or accounting transaction type returned by the read',
      condition: {
        field: 'operation',
        value: [SALES_READ_OPERATION, PURCHASING_READ_OPERATION, ACCOUNTING_READ_OPERATION],
      },
    },
    reportType: {
      type: 'string',
      description: 'Financial report type that was run',
      condition: { field: 'operation', value: REPORT_OPERATION },
    },
    header: {
      type: 'json',
      description: 'Native QuickBooks report header, periods, basis, filters, and options',
      condition: { field: 'operation', value: REPORT_OPERATION },
    },
    columns: {
      type: 'json',
      description: 'Native QuickBooks report column definitions',
      condition: { field: 'operation', value: REPORT_OPERATION },
    },
    rows: {
      type: 'json',
      description: 'Native hierarchical QuickBooks report rows and summaries',
      condition: { field: 'operation', value: REPORT_OPERATION },
    },
    item: {
      type: 'json',
      description:
        'Single master-data, sales, purchasing, or accounting transaction with native QuickBooks fields',
      condition: {
        field: 'operation',
        value: [
          MASTER_DATA_OPERATION,
          SALES_READ_OPERATION,
          PURCHASING_READ_OPERATION,
          ACCOUNTING_READ_OPERATION,
        ],
        and: { field: 'readMode', value: 'by_id' },
      },
    },
    items: {
      type: 'array',
      description:
        'Master-data, sales, purchasing, or accounting transaction objects with native QuickBooks fields',
      condition: LIST_OUTPUT_CONDITION,
    },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first returned list item',
      condition: LIST_OUTPUT_CONDITION,
    },
    maxResults: {
      type: 'number',
      description: 'Actual number of items reported for the list response',
      condition: LIST_OUTPUT_CONDITION,
    },
    nextStartPosition: {
      type: 'number',
      description: 'Position to pass into an explicit next-page request',
      condition: LIST_OUTPUT_CONDITION,
    },
    hasMore: {
      type: 'boolean',
      description: 'Conservative indication that another list page may exist',
      condition: LIST_OUTPUT_CONDITION,
    },
    record: {
      type: 'json',
      description:
        'Created, updated, or voided master-data, sales, purchasing, or accounting record with native QuickBooks fields',
      condition: { field: 'operation', value: [...MUTATION_OPERATIONS] },
    },
    recordId: {
      type: 'string',
      description: 'ID of the created, updated, or voided QuickBooks record',
      condition: { field: 'operation', value: [...MUTATION_OPERATIONS] },
    },
    syncToken: {
      type: 'string',
      description: 'Latest QuickBooks sync token for a subsequent update',
      condition: { field: 'operation', value: [...MUTATION_OPERATIONS] },
    },
    voided: {
      type: 'boolean',
      description: 'True when QuickBooks successfully voided the transaction',
      condition: { field: 'operation', value: [...SALES_VOID_OPERATIONS] },
    },
    linkingRequested: {
      type: 'boolean',
      description: 'Whether Create Bill requested any Purchase Order line links',
      condition: { field: 'operation', value: 'quickbooks_create_bill' },
    },
    linkingSucceeded: {
      type: 'boolean',
      description:
        'Whether QuickBooks returned every requested Purchase Order line link; null when no links were requested',
      condition: { field: 'operation', value: 'quickbooks_create_bill' },
    },
    linkedLines: {
      type: 'array',
      description:
        'Confirmed Purchase Order links as [{purchaseOrderId, purchaseOrderLineId, billLineId}]',
      condition: { field: 'operation', value: 'quickbooks_create_bill' },
    },
    missingLinks: {
      type: 'array',
      description:
        'Requested links omitted by QuickBooks as [{purchaseOrderId, purchaseOrderLineId}]',
      condition: { field: 'operation', value: 'quickbooks_create_bill' },
    },
    linkingWarning: {
      type: 'string',
      description: 'Warning that QuickBooks created the Bill without every requested link',
      condition: { field: 'operation', value: 'quickbooks_create_bill' },
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
    },
  },
}

export const QuickBooksBlockMeta = {
  tags: ['payments', 'automation', 'data-analytics'],
  url: 'https://quickbooks.intuit.com',
  templates: [
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks customer onboarding',
      prompt:
        'Build a workflow that receives an approved customer profile, creates the QuickBooks customer, and stores its ID and sync token in a Sim table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'customers', 'onboarding'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor onboarding',
      prompt:
        'Create a workflow that receives approved vendor identity, contact, address, and 1099 details, creates the QuickBooks vendor, and stores the returned ID and sync token.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'vendors', 'procurement'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks catalogue maintenance',
      prompt:
        'Build a workflow that reads QuickBooks accounts, creates approved Service or Non-inventory items, or updates exposed item fields without changing item types.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'catalogue', 'operations'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks monthly and year-end reporting',
      prompt:
        'Build a scheduled workflow that runs monthly and year-end Balance Sheet, Profit and Loss, Trial Balance, and Cash Flow reports, preserves their native rows and summaries, and stores review results in a Sim table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'financial-close'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks estimate preparation',
      prompt:
        'Build a workflow that receives an approved customer quote and line items, creates a QuickBooks estimate, and stores its ID and sync token for controlled revisions.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'estimates', 'sales'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks invoice creation',
      prompt:
        'Create a workflow that validates approved customer and item IDs, creates a QuickBooks invoice without emailing it, and stores the returned ID and sync token.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'invoices', 'receivables'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks partial-payment application',
      prompt:
        'Build a workflow that records a customer payment, applies bounded amounts to approved QuickBooks invoice IDs, and reports any unapplied remainder.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments', 'receivables'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks journal adjustments and deposits',
      prompt:
        'Build a controlled workflow that posts an explicitly approved, balanced QuickBooks journal entry or records a bounded deposit, then runs cash- and accrual-basis reports to support the accounting review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'accounting', 'journal-entries'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks receivables and payables aging',
      prompt:
        'Create a scheduled workflow that runs A/R and A/P aging summaries and details with approved aging controls, optionally filters by customer or vendor, and flags balances requiring accountant review without changing records.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'aging'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks bill entry and payment',
      prompt:
        'Build a controlled workflow that reads an approved Purchase Order by ID, captures its Line IDs, creates a QuickBooks Bill with explicit PO-line mappings, checks linkingSucceeded and missingLinks, and records a separately approved payment only after reviewing the created Bill.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments', 'payables'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks customer, vendor, and expense analysis',
      prompt:
        'Create a workflow that runs customer and vendor balance reports, sales by customer or product/service, and expenses by vendor with supported account, class, or department filters for accountant review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'onboard-quickbooks-customers',
      description: 'Create approved QuickBooks customers and retain their IDs and sync tokens.',
      content:
        '# Onboard QuickBooks Customers\n\n## Steps\n1. Validate the approved customer identity and contact details.\n2. Use Create Customer with a unique display name.\n3. Store the returned `recordId` and `syncToken` for later updates.\n\n## Output\nReturn the created customer, ID, and sync token. Report duplicate-name faults for human review.',
    },
    {
      name: 'onboard-quickbooks-vendors',
      description: 'Create approved QuickBooks vendors with bounded contact and 1099 fields.',
      content:
        '# Onboard QuickBooks Vendors\n\n## Steps\n1. Validate the approved vendor identity, contact, address, and optional 1099 status.\n2. Use Create Vendor.\n3. Store the returned `recordId` and `syncToken`.\n\n## Output\nReturn the created vendor and identifiers. Do not claim to merge vendors or administer tax identifiers.',
    },
    {
      name: 'maintain-products-and-services',
      description: 'Create supported items or update exposed item fields without changing types.',
      content:
        '# Maintain QuickBooks Products and Services\n\n## Steps\n1. Read Account master data to obtain approved account IDs.\n2. Create a Service or Non-inventory Item, or update exposed basic fields without changing the existing item Type.\n3. Store the latest item ID and sync token.\n\n## Output\nReturn the native Item record. Do not claim to create Inventory, Category, or Group items or manage their specialized fields.',
    },
    {
      name: 'record-quickbooks-accounting-adjustments',
      description: 'Post approved balanced journal entries, record deposits, and review transfers.',
      content:
        '# Record QuickBooks Accounting Adjustments\n\n## Steps\n1. Read the approved account IDs from Master Data.\n2. For a journal entry, verify that positive debit and credit lines balance and require explicit posting confirmation; for a deposit, verify the destination and source account IDs.\n3. Store the returned `recordId` and `syncToken`; use Read Accounting Transactions to review journal entries, deposits, or read-only transfers.\n4. Run an approved Trial Balance or financial statement on cash or accrual basis when an accountant requests post-adjustment review.\n\n## Output\nReturn the native accounting transaction and identifiers plus the native report hierarchy when requested. Do not claim to create transfers, replace transaction lines, or administer currencies.',
    },
    {
      name: 'prepare-quickbooks-estimates',
      description: 'Create and revise bounded QuickBooks estimates from approved quote details.',
      content:
        '# Prepare QuickBooks Estimates\n\n## Steps\n1. Validate the customer, item IDs, amounts, and dates.\n2. Use Create Estimate with bounded item or description lines.\n3. For a revision, use the estimate ID and latest `syncToken` with Update Estimate.\n\n## Output\nReturn the native Estimate, ID, and latest sync token. Do not claim to email or accept the estimate.',
    },
    {
      name: 'create-quickbooks-invoices',
      description: 'Create approved QuickBooks invoices and retain identifiers for later updates.',
      content:
        '# Create QuickBooks Invoices\n\n## Steps\n1. Validate the approved customer, item IDs, positive amounts, and optional dates.\n2. Use Create Invoice with at least one bounded line.\n3. Store the returned `recordId` and `syncToken`.\n\n## Output\nReturn the native Invoice and identifiers. Do not claim to email the invoice or collect payment automatically.',
    },
    {
      name: 'record-quickbooks-payables',
      description:
        'Create standalone or PO-linked bills and record bounded payments to approved Bill IDs.',
      content:
        '# Record QuickBooks Payables\n\n## Steps\n1. Validate the vendor, expense lines, and optional A/P account.\n2. For PO-linked billing, use Read Purchasing Transactions by ID and copy each approved Purchase Order `Line[].Id` into the matching Create Bill line with its PO ID.\n3. Use Create Bill, store its ID and sync token, and inspect `linkingSucceeded` and `missingLinks`; QuickBooks may create the Bill while omitting an invalid or unavailable link.\n4. When payment is separately approved, use Create Bill Payment with bounded Bill allocations whose amounts equal the payment total.\n5. Run A/P Aging Summary or Detail with supported vendor, department, date, and aging controls for accountant review.\n\n## Output\nAlways return the created Bill ID and linkage result. Preserve the native aging report when requested. Never imply that a missing link prevented Bill creation, and never create a payment implicitly.',
    },
    {
      name: 'analyze-quickbooks-financial-reports',
      description:
        'Run verified financial, balance, aging, sales, and expense reports with supported filters.',
      content:
        '# Analyze QuickBooks Financial Reports\n\n## Steps\n1. Choose a verified report and an accountant-approved date or as-of period.\n2. Use Read Master Data to discover customer, vendor, account, item, class, or department IDs required by supported filters.\n3. Run Financial Report with only the controls shown for that report; compare cash and accrual basis or time summaries when requested.\n4. Preserve the native Header, Columns, nested Rows, and summaries for review.\n\n## Output\nReturn the report hierarchy and applied report context. Do not claim to export spreadsheets, email reports, customize columns, schedule delivery in QuickBooks, or mutate accounting records from a report.',
    },
  ],
} as const satisfies BlockMeta
