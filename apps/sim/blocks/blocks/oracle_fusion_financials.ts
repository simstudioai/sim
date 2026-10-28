import { OracleIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

export const OracleFusionFinancialsBlock: BlockConfig = {
  type: 'oracle_fusion_financials',
  name: 'Oracle Fusion Financials',
  description: 'Manage receivables and expenses, and report on payables and ledgers',
  longDescription:
    'Connect your Oracle Fusion Applications integration user through a reusable saved credential. Read payables invoices and payments; create and update receivables invoices, read their lines and installments, create credit memos, and create and apply receipts. Create, update, and submit expense reports and their expense lines. Read ledgers, journal batches, and ledger balances. Lists return one bounded page at a time. Oracle roles, business-unit access, and business validation still apply.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_financials',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.OAuth,
  bgColor: '#C74634',
  icon: OracleIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Financials',
    sentences: {
      byOperation: {
        oracle_fusion_financials_apply_receivables_receipt: ['Apply Receivables Receipt'],
        oracle_fusion_financials_approve_receivables_invoice: ['Approve Receivables Invoice'],
        oracle_fusion_financials_create_expense_line: ['Create Expense Line'],
        oracle_fusion_financials_create_expense_report: ['Create Expense Report'],
        oracle_fusion_financials_create_receivables_credit_memo: ['Create Receivables Credit Memo'],
        oracle_fusion_financials_create_receivables_invoice: ['Create Receivables Invoice'],
        oracle_fusion_financials_create_receivables_receipt: ['Create Receivables Receipt'],
        oracle_fusion_financials_get_expense_line: ['Get Expense Line'],
        oracle_fusion_financials_get_expense_report: ['Get Expense Report'],
        oracle_fusion_financials_get_gl_journal_batch: ['Get GL Journal Batch'],
        oracle_fusion_financials_get_gl_ledger: ['Get GL Ledger'],
        oracle_fusion_financials_get_payables_invoice: ['Get Payables Invoice'],
        oracle_fusion_financials_get_payables_invoice_line: ['Get Payables Invoice Line'],
        oracle_fusion_financials_get_payables_payment: ['Get Payables Payment'],
        oracle_fusion_financials_get_receivables_credit_memo: ['Get Receivables Credit Memo'],
        oracle_fusion_financials_get_receivables_invoice: ['Get Receivables Invoice'],
        oracle_fusion_financials_get_receivables_invoice_installment: [
          'Get Receivables Invoice Installment',
        ],
        oracle_fusion_financials_get_receivables_invoice_line: ['Get Receivables Invoice Line'],
        oracle_fusion_financials_get_receivables_receipt: ['Get Receivables Receipt'],
        oracle_fusion_financials_list_expense_lines: ['List Expense Lines'],
        oracle_fusion_financials_list_expense_reports: ['List Expense Reports'],
        oracle_fusion_financials_list_gl_balances: ['List GL Balances'],
        oracle_fusion_financials_list_gl_journal_batches: ['List GL Journal Batches'],
        oracle_fusion_financials_list_gl_ledgers: ['List GL Ledgers'],
        oracle_fusion_financials_list_payables_invoice_lines: ['List Payables Invoice Lines'],
        oracle_fusion_financials_list_payables_invoices: ['List Payables Invoices'],
        oracle_fusion_financials_list_payables_payments: ['List Payables Payments'],
        oracle_fusion_financials_list_receivables_credit_memos: ['List Receivables Credit Memos'],
        oracle_fusion_financials_list_receivables_invoice_installments: [
          'List Receivables Invoice Installments',
        ],
        oracle_fusion_financials_list_receivables_invoice_lines: ['List Receivables Invoice Lines'],
        oracle_fusion_financials_list_receivables_invoices: ['List Receivables Invoices'],
        oracle_fusion_financials_list_receivables_receipts: ['List Receivables Receipts'],
        oracle_fusion_financials_submit_expense_report: ['Submit Expense Report'],
        oracle_fusion_financials_update_expense_line: ['Update Expense Line'],
        oracle_fusion_financials_update_expense_report: ['Update Expense Report'],
        oracle_fusion_financials_update_receivables_invoice: ['Update Receivables Invoice'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      value: () => 'oracle_fusion_financials_list_payables_invoices',
      options: [
        {
          id: 'oracle_fusion_financials_apply_receivables_receipt',
          label: 'Apply Receivables Receipt',
        },
        {
          id: 'oracle_fusion_financials_approve_receivables_invoice',
          label: 'Approve Receivables Invoice',
        },
        {
          id: 'oracle_fusion_financials_create_expense_line',
          label: 'Create Expense Line',
        },
        {
          id: 'oracle_fusion_financials_create_expense_report',
          label: 'Create Expense Report',
        },
        {
          id: 'oracle_fusion_financials_create_receivables_credit_memo',
          label: 'Create Receivables Credit Memo',
        },
        {
          id: 'oracle_fusion_financials_create_receivables_invoice',
          label: 'Create Receivables Invoice',
        },
        {
          id: 'oracle_fusion_financials_create_receivables_receipt',
          label: 'Create Receivables Receipt',
        },
        {
          id: 'oracle_fusion_financials_get_expense_line',
          label: 'Get Expense Line',
        },
        {
          id: 'oracle_fusion_financials_get_expense_report',
          label: 'Get Expense Report',
        },
        {
          id: 'oracle_fusion_financials_get_gl_journal_batch',
          label: 'Get GL Journal Batch',
        },
        {
          id: 'oracle_fusion_financials_get_gl_ledger',
          label: 'Get GL Ledger',
        },
        {
          id: 'oracle_fusion_financials_get_payables_invoice',
          label: 'Get Payables Invoice',
        },
        {
          id: 'oracle_fusion_financials_get_payables_invoice_line',
          label: 'Get Payables Invoice Line',
        },
        {
          id: 'oracle_fusion_financials_get_payables_payment',
          label: 'Get Payables Payment',
        },
        {
          id: 'oracle_fusion_financials_get_receivables_credit_memo',
          label: 'Get Receivables Credit Memo',
        },
        {
          id: 'oracle_fusion_financials_get_receivables_invoice',
          label: 'Get Receivables Invoice',
        },
        {
          id: 'oracle_fusion_financials_get_receivables_invoice_installment',
          label: 'Get Receivables Invoice Installment',
        },
        {
          id: 'oracle_fusion_financials_get_receivables_invoice_line',
          label: 'Get Receivables Invoice Line',
        },
        {
          id: 'oracle_fusion_financials_get_receivables_receipt',
          label: 'Get Receivables Receipt',
        },
        {
          id: 'oracle_fusion_financials_list_expense_lines',
          label: 'List Expense Lines',
        },
        {
          id: 'oracle_fusion_financials_list_expense_reports',
          label: 'List Expense Reports',
        },
        {
          id: 'oracle_fusion_financials_list_gl_balances',
          label: 'List GL Balances',
        },
        {
          id: 'oracle_fusion_financials_list_gl_journal_batches',
          label: 'List GL Journal Batches',
        },
        {
          id: 'oracle_fusion_financials_list_gl_ledgers',
          label: 'List GL Ledgers',
        },
        {
          id: 'oracle_fusion_financials_list_payables_invoice_lines',
          label: 'List Payables Invoice Lines',
        },
        {
          id: 'oracle_fusion_financials_list_payables_invoices',
          label: 'List Payables Invoices',
        },
        {
          id: 'oracle_fusion_financials_list_payables_payments',
          label: 'List Payables Payments',
        },
        {
          id: 'oracle_fusion_financials_list_receivables_credit_memos',
          label: 'List Receivables Credit Memos',
        },
        {
          id: 'oracle_fusion_financials_list_receivables_invoice_installments',
          label: 'List Receivables Invoice Installments',
        },
        {
          id: 'oracle_fusion_financials_list_receivables_invoice_lines',
          label: 'List Receivables Invoice Lines',
        },
        {
          id: 'oracle_fusion_financials_list_receivables_invoices',
          label: 'List Receivables Invoices',
        },
        {
          id: 'oracle_fusion_financials_list_receivables_receipts',
          label: 'List Receivables Receipts',
        },
        {
          id: 'oracle_fusion_financials_submit_expense_report',
          label: 'Submit Expense Report',
        },
        {
          id: 'oracle_fusion_financials_update_expense_line',
          label: 'Update Expense Line',
        },
        {
          id: 'oracle_fusion_financials_update_expense_report',
          label: 'Update Expense Report',
        },
        {
          id: 'oracle_fusion_financials_update_receivables_invoice',
          label: 'Update Receivables Invoice',
        },
      ],
    },
    {
      id: 'oauthCredential',
      title: 'Oracle Fusion account',
      type: 'oauth-input',
      serviceId: 'oracle-fusion',
      requiredScopes: getScopesForService('oracle-fusion'),
      required: true,
    },
    {
      id: 'receivablesReceiptId',
      title: 'Receivables Receipt ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_apply_receivables_receipt',
          'oracle_fusion_financials_get_receivables_receipt',
        ],
      },
      required: true,
    },
    {
      id: 'appliedPaymentScheduleId',
      title: 'Applied Payment Schedule ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_apply_receivables_receipt',
      },
      required: true,
    },
    {
      id: 'amountApplied',
      title: 'Amount Applied',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter amount applied',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_apply_receivables_receipt',
      },
    },
    {
      id: 'calledFrom',
      title: 'Called From',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter called from',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_apply_receivables_receipt',
      },
      mode: 'advanced',
    },
    {
      id: 'receivablesInvoiceId',
      title: 'Receivables Invoice ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_get_receivables_invoice',
          'oracle_fusion_financials_get_receivables_invoice_installment',
          'oracle_fusion_financials_get_receivables_invoice_line',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
      required: true,
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      value: () => '',
      placeholder: 'Enter comment',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_approve_receivables_invoice',
      },
    },
    {
      id: 'expenseReportUniqId',
      title: 'Expense Report Key',
      type: 'short-input',
      value: () => '',
      placeholder: 'Use the opaque key returned by a list operation',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_get_expense_report',
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_submit_expense_report',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      required: true,
    },
    {
      id: 'assignmentId',
      title: 'Assignment ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_expense_line',
      },
    },
    {
      id: 'orgId',
      title: 'Org ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_expense_report',
        ],
      },
    },
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_expense_line',
      },
    },
    {
      id: 'ticketClass',
      title: 'Ticket Class',
      type: 'dropdown',
      value: () => '',
      options: [
        { id: '', label: 'Select ticket class' },
        { id: 'BUSINESS', label: 'Business' },
        { id: 'ECONOMY', label: 'Economy' },
      ],
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_expense_line',
      },
    },
    {
      id: 'expenseTypeId',
      title: 'Expense Type ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'expenseTemplateId',
      title: 'Expense Template ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      value: () => '',
      placeholder: 'Enter description',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'justification',
      title: 'Justification',
      type: 'long-input',
      value: () => '',
      placeholder: 'Enter justification',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'receiptAmount',
      title: 'Receipt Amount',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter receipt amount',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'receiptCurrencyCode',
      title: 'Receipt Currency Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'USD',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'receiptDate',
      title: 'Receipt Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'merchantName',
      title: 'Merchant Name',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter merchant name',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'exchangeRate',
      title: 'Exchange Rate',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter exchange rate',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'reimbursementCurrencyCode',
      title: 'Reimbursement Currency Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'USD',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_line',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'itemizationParentExpenseId',
      title: 'Itemization Parent Expense ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'receiptMissingFlag',
      title: 'Receipt Missing Flag',
      type: 'dropdown',
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
      options: [
        {
          id: '',
          label: 'Use Oracle default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter location',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'countryCode',
      title: 'Country Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter country code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'expenseCategoryCode',
      title: 'Expense Category Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter expense category code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'expenseSource',
      title: 'Expense Source',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter expense source',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'numberOfDays',
      title: 'Number Of Days',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter number of days',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'numberOfAttendees',
      title: 'Number Of Attendees',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter number of attendees',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'tripDistance',
      title: 'Trip Distance',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter trip distance',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'distanceUnitCode',
      title: 'Distance Unit Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter distance unit code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'ticketClassCode',
      title: 'Ticket Class Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter ticket class code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'ticketNumber',
      title: 'Ticket Number',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter ticket number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'preparerId',
      title: 'Preparer ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_expense_report',
      },
      mode: 'advanced',
    },
    {
      id: 'purpose',
      title: 'Purpose',
      type: 'long-input',
      value: () => '',
      placeholder: 'Enter purpose',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    {
      id: 'expenseReportNumber',
      title: 'Expense Report Number',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter expense report number',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_expense_report',
      },
    },
    {
      id: 'expenseReportDate',
      title: 'Expense Report Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'exchangeRateType',
      title: 'Exchange Rate Type',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter exchange rate type',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'paymentMethodCode',
      title: 'Payment Method Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter payment method code',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'overrideApproverId',
      title: 'Override Approver ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'unappliedAdvancesJust',
      title: 'Unapplied Advances Just',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter unapplied advances just',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'unappliedCashAdvReason',
      title: 'Unapplied Cash Adv Reason',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter unapplied cash adv reason',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'businessUnit',
      title: 'Business Unit',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter business unit',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
    },
    {
      id: 'transactionNumber',
      title: 'Transaction Number',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter transaction number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
    },
    {
      id: 'transactionDate',
      title: 'Transaction Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'accountingDate',
      title: 'Accounting Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'billToCustomerName',
      title: 'Bill To Customer Name',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter bill to customer name',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'billToCustomerNumber',
      title: 'Bill To Customer Number',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter bill to customer number',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
    },
    {
      id: 'billToSite',
      title: 'Bill To Site',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter bill to site',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
    },
    {
      id: 'creditMemoCurrency',
      title: 'Credit Memo Currency',
      type: 'short-input',
      value: () => '',
      placeholder: 'USD',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
    },
    {
      id: 'creditMemoStatus',
      title: 'Credit Memo Status',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter credit memo status',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
      mode: 'advanced',
    },
    {
      id: 'creditReason',
      title: 'Credit Reason',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter credit reason',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
    },
    {
      id: 'freightCreditAmount',
      title: 'Freight Credit Amount',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter freight credit amount',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
      mode: 'advanced',
    },
    {
      id: 'transactionSource',
      title: 'Transaction Source',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter transaction source',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
    },
    {
      id: 'transactionType',
      title: 'Transaction Type',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter transaction type',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
    },
    {
      id: 'creditMemoComments',
      title: 'Credit Memo Comments',
      type: 'long-input',
      value: () => '',
      placeholder: 'Enter credit memo comments',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
      mode: 'advanced',
    },
    {
      id: 'conversionRate',
      title: 'Conversion Rate',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter conversion rate',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'conversionRateType',
      title: 'Conversion Rate Type',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter conversion rate type',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'conversionRateDate',
      title: 'Conversion Rate Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_credit_memo',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'lines',
      title: 'Lines',
      type: 'code',
      value: () => '',
      placeholder: '[{"LineNumber":1}]',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
      language: 'json',
    },
    {
      id: 'distributions',
      title: 'Distributions',
      type: 'code',
      value: () => '',
      placeholder: '[{"AccountClass":"REV","Amount":100}]',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_create_receivables_invoice',
        ],
      },
      mode: 'advanced',
      language: 'json',
    },
    {
      id: 'invoiceCurrencyCode',
      title: 'Invoice Currency Code',
      type: 'short-input',
      value: () => '',
      placeholder: 'USD',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_invoice',
      },
    },
    {
      id: 'invoiceStatus',
      title: 'Invoice Status',
      type: 'dropdown',
      value: () => '',
      dependsOn: ['operation'],
      options: ({ values } = { values: {} }) => [
        { id: '', label: 'Use Oracle default' },
        { id: 'Complete', label: 'Complete' },
        ...(values.operation === 'oracle_fusion_financials_update_receivables_invoice'
          ? [
              { id: 'Incomplete', label: 'Incomplete' },
              { id: 'Frozen', label: 'Frozen' },
            ]
          : []),
      ],
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
      placeholder: 'Complete on create; Complete, Incomplete, or Frozen on update',
    },
    {
      id: 'paymentTerms',
      title: 'Payment Terms',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter payment terms',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
    },
    {
      id: 'comments',
      title: 'Comments',
      type: 'long-input',
      value: () => '',
      placeholder: 'Enter comments',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'purchaseOrder',
      title: 'Purchase Order',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter purchase order',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_invoice',
      },
      mode: 'advanced',
    },
    {
      id: 'conversionDate',
      title: 'Conversion Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_create_receivables_receipt',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter amount',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      required: true,
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      value: () => '',
      placeholder: 'USD',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      required: true,
    },
    {
      id: 'receiptMethod',
      title: 'Receipt Method',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter receipt method',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      required: true,
    },
    {
      id: 'receiptNumber',
      title: 'Receipt Number',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter receipt number',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
    },
    {
      id: 'customerAccountNumber',
      title: 'Customer Account Number',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter customer account number',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
    },
    {
      id: 'customerName',
      title: 'Customer Name',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter customer name',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      mode: 'advanced',
    },
    {
      id: 'customerSite',
      title: 'Customer Site',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter customer site',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
    },
    {
      id: 'maturityDate',
      title: 'Maturity Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
    {
      id: 'structuredPaymentReference',
      title: 'Structured Payment Reference',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter structured payment reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_create_receivables_receipt',
      },
      mode: 'advanced',
    },
    {
      id: 'expenseLineUniqId',
      title: 'Expense Line Key',
      type: 'short-input',
      value: () => '',
      placeholder: 'Use the opaque key returned by a list operation',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
      required: true,
    },
    {
      id: 'glJournalBatchId',
      title: 'GL Journal Batch ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_gl_journal_batch',
      },
      required: true,
    },
    {
      id: 'glLedgerId',
      title: 'GL Ledger ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_gl_ledger',
      },
      required: true,
    },
    {
      id: 'invoiceUniqId',
      title: 'Invoice Key',
      type: 'short-input',
      value: () => '',
      placeholder: 'Use the opaque key returned by a list operation',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_lines',
        ],
      },
      required: true,
    },
    {
      id: 'invoiceLineUniqId',
      title: 'Invoice Line Key',
      type: 'short-input',
      value: () => '',
      placeholder: 'Use the opaque key returned by a list operation',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_line',
      },
      required: true,
    },
    {
      id: 'checkId',
      title: 'Check ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment',
      },
      required: true,
    },
    {
      id: 'receivablesCreditMemoId',
      title: 'Receivables Credit Memo ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_receivables_credit_memo',
      },
      required: true,
    },
    {
      id: 'receivablesInvoiceInstallmentId',
      title: 'Receivables Invoice Installment ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_receivables_invoice_installment',
      },
      required: true,
    },
    {
      id: 'receivablesInvoiceLineId',
      title: 'Receivables Invoice Line ID',
      type: 'short-input',
      value: () => '',
      placeholder: 'Enter the exact decimal ID or a workflow reference',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_receivables_invoice_line',
      },
      required: true,
    },
    {
      id: 'q',
      title: 'Q',
      type: 'short-input',
      value: () => '',
      placeholder: "InvoiceNumber='INV-1001'",
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate an Oracle Fusion REST Framework q expression using only documented attributes or finders for the selected resource. Example: InvoiceNumber='INV-1001'. Return ONLY the expression.",
        placeholder: 'Describe the records or ordering you need',
      },
    },
    {
      id: 'finder',
      title: 'Finder',
      type: 'short-input',
      value: () => '',
      placeholder: 'PrimaryKey;InvoiceId=300100000000001',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Fusion REST Framework finder expression using only documented attributes or finders for the selected resource. Example: PrimaryKey;InvoiceId=300100000000001. Return ONLY the expression.',
        placeholder: 'Describe the records or ordering you need',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      value: () => '',
      placeholder: 'CreationDate:desc',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Fusion REST Framework orderBy expression using only documented attributes or finders for the selected resource. Example: CreationDate:desc. Return ONLY the expression.',
        placeholder: 'Describe the records or ordering you need',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      value: () => '',
      placeholder: '50 (default; maximum 100)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      value: () => '',
      placeholder: '0 (first page)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'totalResults',
      title: 'Total Results',
      type: 'dropdown',
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
      mode: 'advanced',
      options: [
        {
          id: '',
          label: 'Use Oracle default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
    },
    {
      id: 'effectiveDate',
      title: 'Effective Date',
      type: 'short-input',
      value: () => '',
      placeholder: '2026-01-31',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_list_payables_invoices',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the date, such as the last day of this month',
      },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_financials_apply_receivables_receipt',
      'oracle_fusion_financials_approve_receivables_invoice',
      'oracle_fusion_financials_create_expense_line',
      'oracle_fusion_financials_create_expense_report',
      'oracle_fusion_financials_create_receivables_credit_memo',
      'oracle_fusion_financials_create_receivables_invoice',
      'oracle_fusion_financials_create_receivables_receipt',
      'oracle_fusion_financials_get_expense_line',
      'oracle_fusion_financials_get_expense_report',
      'oracle_fusion_financials_get_gl_journal_batch',
      'oracle_fusion_financials_get_gl_ledger',
      'oracle_fusion_financials_get_payables_invoice',
      'oracle_fusion_financials_get_payables_invoice_line',
      'oracle_fusion_financials_get_payables_payment',
      'oracle_fusion_financials_get_receivables_credit_memo',
      'oracle_fusion_financials_get_receivables_invoice',
      'oracle_fusion_financials_get_receivables_invoice_installment',
      'oracle_fusion_financials_get_receivables_invoice_line',
      'oracle_fusion_financials_get_receivables_receipt',
      'oracle_fusion_financials_list_expense_lines',
      'oracle_fusion_financials_list_expense_reports',
      'oracle_fusion_financials_list_gl_balances',
      'oracle_fusion_financials_list_gl_journal_batches',
      'oracle_fusion_financials_list_gl_ledgers',
      'oracle_fusion_financials_list_payables_invoice_lines',
      'oracle_fusion_financials_list_payables_invoices',
      'oracle_fusion_financials_list_payables_payments',
      'oracle_fusion_financials_list_receivables_credit_memos',
      'oracle_fusion_financials_list_receivables_invoice_installments',
      'oracle_fusion_financials_list_receivables_invoice_lines',
      'oracle_fusion_financials_list_receivables_invoices',
      'oracle_fusion_financials_list_receivables_receipts',
      'oracle_fusion_financials_submit_expense_report',
      'oracle_fusion_financials_update_expense_line',
      'oracle_fusion_financials_update_expense_report',
      'oracle_fusion_financials_update_receivables_invoice',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const { operation: _operation, ...resolved } = params
        const result: Record<string, unknown> = { ...resolved }
        for (const field of [
          'amountApplied',
          'receiptAmount',
          'exchangeRate',
          'numberOfDays',
          'numberOfAttendees',
          'tripDistance',
          'conversionRate',
          'amount',
          'limit',
          'offset',
        ]) {
          const value = resolved[field]
          result[field] = value === null ? null : parseOptionalNumberInput(value, field)
        }
        for (const field of ['receiptMissingFlag', 'totalResults']) {
          const value = resolved[field]
          result[field] = value === null ? null : parseOptionalBooleanInput(value)
        }
        for (const field of ['lines', 'distributions']) {
          const value = resolved[field]
          result[field] = value === null ? null : parseOptionalJsonInput(value, field)
        }
        for (const field of [
          'receivablesReceiptId',
          'appliedPaymentScheduleId',
          'calledFrom',
          'receivablesInvoiceId',
          'comment',
          'expenseReportUniqId',
          'assignmentId',
          'orgId',
          'personId',
          'ticketClass',
          'expenseTypeId',
          'expenseTemplateId',
          'description',
          'justification',
          'receiptCurrencyCode',
          'receiptDate',
          'merchantName',
          'startDate',
          'endDate',
          'reimbursementCurrencyCode',
          'itemizationParentExpenseId',
          'location',
          'countryCode',
          'expenseCategoryCode',
          'expenseSource',
          'distanceUnitCode',
          'ticketClassCode',
          'ticketNumber',
          'preparerId',
          'purpose',
          'expenseReportNumber',
          'expenseReportDate',
          'exchangeRateType',
          'paymentMethodCode',
          'overrideApproverId',
          'unappliedAdvancesJust',
          'unappliedCashAdvReason',
          'businessUnit',
          'transactionNumber',
          'transactionDate',
          'accountingDate',
          'billToCustomerName',
          'billToCustomerNumber',
          'billToSite',
          'creditMemoCurrency',
          'creditMemoStatus',
          'creditReason',
          'freightCreditAmount',
          'transactionSource',
          'transactionType',
          'creditMemoComments',
          'conversionRateType',
          'conversionRateDate',
          'invoiceCurrencyCode',
          'invoiceStatus',
          'paymentTerms',
          'comments',
          'purchaseOrder',
          'conversionDate',
          'currency',
          'receiptMethod',
          'receiptNumber',
          'customerAccountNumber',
          'customerName',
          'customerSite',
          'maturityDate',
          'structuredPaymentReference',
          'expenseLineUniqId',
          'glJournalBatchId',
          'glLedgerId',
          'invoiceUniqId',
          'invoiceLineUniqId',
          'checkId',
          'receivablesCreditMemoId',
          'receivablesInvoiceInstallmentId',
          'receivablesInvoiceLineId',
          'q',
          'finder',
          'orderBy',
          'effectiveDate',
        ]) {
          if (result[field] === '') result[field] = undefined
        }
        return result
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Oracle Fusion Financials operation to perform',
    },
    oauthCredential: {
      type: 'string',
      description: 'Oracle Fusion Cloud Financials service-account credential',
    },
    receivablesReceiptId: {
      type: 'string',
      description: 'receivables Receipt Id (exact decimal resource identifier)',
    },
    appliedPaymentScheduleId: {
      type: 'string',
      description: 'Invoice installment identifier as an exact decimal string',
    },
    amountApplied: {
      type: 'number',
      description: 'Amount to apply; omitted means the full open transaction balance',
    },
    calledFrom: {
      type: 'string',
      description: 'Caller or process name recorded for audit',
    },
    receivablesInvoiceId: {
      type: 'string',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    comment: {
      type: 'string',
      description: 'Note recorded in the approval audit history',
    },
    expenseReportUniqId: {
      type: 'string',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
    assignmentId: {
      type: 'string',
      description: 'Assignment Id as an exact integer string',
    },
    orgId: {
      type: 'string',
      description: 'Org Id as an exact integer string',
    },
    personId: {
      type: 'string',
      description: 'Person Id as an exact integer string',
    },
    ticketClass: {
      type: 'string',
      description: 'Ticket Class',
    },
    expenseTypeId: {
      type: 'string',
      description: 'Expense Type Id as an exact integer string',
    },
    expenseTemplateId: {
      type: 'string',
      description: 'Expense Template Id as an exact integer string',
    },
    description: {
      type: 'string',
      description: 'Description',
    },
    justification: {
      type: 'string',
      description: 'Justification',
    },
    receiptAmount: {
      type: 'number',
      description: 'Receipt Amount',
    },
    receiptCurrencyCode: {
      type: 'string',
      description: 'Receipt Currency Code',
    },
    receiptDate: {
      type: 'string',
      description: 'Receipt Date (YYYY-MM-DD)',
    },
    merchantName: {
      type: 'string',
      description: 'Merchant Name',
    },
    startDate: {
      type: 'string',
      description: 'Start Date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      description: 'End Date',
    },
    exchangeRate: {
      type: 'number',
      description: 'Exchange Rate',
    },
    reimbursementCurrencyCode: {
      type: 'string',
      description: 'Reimbursement Currency Code',
    },
    itemizationParentExpenseId: {
      type: 'string',
      description: 'Itemization Parent Expense Id as an exact integer string',
    },
    receiptMissingFlag: {
      type: 'boolean',
      description: 'Receipt Missing Flag',
    },
    location: {
      type: 'string',
      description: 'Location',
    },
    countryCode: {
      type: 'string',
      description: 'Country Code',
    },
    expenseCategoryCode: {
      type: 'string',
      description: 'Expense Category Code',
    },
    expenseSource: {
      type: 'string',
      description: 'Expense Source',
    },
    numberOfDays: {
      type: 'number',
      description: 'Number Of Days',
    },
    numberOfAttendees: {
      type: 'number',
      description: 'Number Of Attendees',
    },
    tripDistance: {
      type: 'number',
      description: 'Trip Distance',
    },
    distanceUnitCode: {
      type: 'string',
      description: 'Distance Unit Code',
    },
    ticketClassCode: {
      type: 'string',
      description: 'Ticket Class Code',
    },
    ticketNumber: {
      type: 'string',
      description: 'Ticket Number',
    },
    preparerId: {
      type: 'string',
      description: 'Preparer Id as an exact integer string',
    },
    purpose: {
      type: 'string',
      description: 'Purpose',
    },
    expenseReportNumber: {
      type: 'string',
      description: 'Expense Report Number',
    },
    expenseReportDate: {
      type: 'string',
      description: 'Expense Report Date (YYYY-MM-DD)',
    },
    exchangeRateType: {
      type: 'string',
      description: 'Exchange Rate Type',
    },
    paymentMethodCode: {
      type: 'string',
      description: 'Payment Method Code',
    },
    overrideApproverId: {
      type: 'string',
      description: 'Override Approver Id as an exact integer string',
    },
    unappliedAdvancesJust: {
      type: 'string',
      description: 'Unapplied Advances Just',
    },
    unappliedCashAdvReason: {
      type: 'string',
      description: 'Unapplied Cash Adv Reason',
    },
    businessUnit: {
      type: 'string',
      description: 'Business Unit',
    },
    transactionNumber: {
      type: 'string',
      description: 'Transaction Number',
    },
    transactionDate: {
      type: 'string',
      description: 'Transaction Date (YYYY-MM-DD)',
    },
    accountingDate: {
      type: 'string',
      description: 'Accounting Date (YYYY-MM-DD)',
    },
    billToCustomerName: {
      type: 'string',
      description: 'Bill To Customer Name',
    },
    billToCustomerNumber: {
      type: 'string',
      description: 'Bill To Customer Number',
    },
    billToSite: {
      type: 'string',
      description: 'Bill To Site',
    },
    creditMemoCurrency: {
      type: 'string',
      description: 'Credit Memo Currency',
    },
    creditMemoStatus: {
      type: 'string',
      description: 'Credit Memo Status',
    },
    creditReason: {
      type: 'string',
      description: 'Credit Reason',
    },
    freightCreditAmount: {
      type: 'string',
      description: 'Freight Credit Amount',
    },
    transactionSource: {
      type: 'string',
      description: 'Transaction Source',
    },
    transactionType: {
      type: 'string',
      description: 'Transaction Type',
    },
    creditMemoComments: {
      type: 'string',
      description: 'Credit Memo Comments',
    },
    conversionRate: {
      type: 'number',
      description: 'Conversion Rate',
    },
    conversionRateType: {
      type: 'string',
      description: 'Conversion Rate Type',
    },
    conversionRateDate: {
      type: 'string',
      description: 'Conversion Rate Date (YYYY-MM-DD)',
    },
    lines: {
      type: 'array',
      description:
        'Typed lines to create with the receivables credit memo (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
    },
    distributions: {
      type: 'array',
      description:
        'Typed distributions to create with the receivables credit memo (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
    },
    invoiceCurrencyCode: {
      type: 'string',
      description: 'Invoice Currency Code',
    },
    invoiceStatus: {
      type: 'string',
      description: 'Invoice Status',
    },
    paymentTerms: {
      type: 'string',
      description: 'Payment Terms',
    },
    comments: {
      type: 'string',
      description: 'Comments',
    },
    purchaseOrder: {
      type: 'string',
      description: 'Purchase Order',
    },
    conversionDate: {
      type: 'string',
      description: 'Conversion Date (YYYY-MM-DD)',
    },
    amount: {
      type: 'number',
      description: 'Amount',
    },
    currency: {
      type: 'string',
      description: 'Currency',
    },
    receiptMethod: {
      type: 'string',
      description: 'Receipt Method',
    },
    receiptNumber: {
      type: 'string',
      description: 'Receipt Number',
    },
    customerAccountNumber: {
      type: 'string',
      description: 'Customer Account Number',
    },
    customerName: {
      type: 'string',
      description: 'Customer Name',
    },
    customerSite: {
      type: 'string',
      description: 'Customer Site',
    },
    maturityDate: {
      type: 'string',
      description: 'Maturity Date (YYYY-MM-DD)',
    },
    structuredPaymentReference: {
      type: 'string',
      description: 'Structured Payment Reference',
    },
    expenseLineUniqId: {
      type: 'string',
      description: 'Expense Line Uniq Id returned by Oracle; preserve it exactly',
    },
    glJournalBatchId: {
      type: 'string',
      description: 'GL Journal Batch Id returned by Oracle; preserve it exactly',
    },
    glLedgerId: {
      type: 'string',
      description: 'GL Ledger Id returned by Oracle; preserve it exactly',
    },
    invoiceUniqId: {
      type: 'string',
      description: 'Opaque invoice key returned by an Oracle Fusion invoice list',
    },
    invoiceLineUniqId: {
      type: 'string',
      description: 'Opaque invoice-line key returned by Oracle Fusion',
    },
    checkId: {
      type: 'string',
      description: 'Oracle payment CheckId as a decimal string',
    },
    receivablesCreditMemoId: {
      type: 'string',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
    receivablesInvoiceInstallmentId: {
      type: 'string',
      description: 'receivables Invoice Installment Id (exact decimal resource identifier)',
    },
    receivablesInvoiceLineId: {
      type: 'string',
      description: 'receivables Invoice Line Id (exact decimal resource identifier)',
    },
    q: {
      type: 'string',
      description: 'Oracle REST Framework q filter expression',
    },
    finder: {
      type: 'string',
      description: 'Oracle predefined finder expression',
    },
    orderBy: {
      type: 'string',
      description: 'Comma-separated Oracle attributes with optional :asc or :desc direction',
    },
    limit: {
      type: 'number',
      description: 'Records in this page (integer from 1 to 100; default 50)',
    },
    offset: {
      type: 'number',
      description: 'Zero-based record offset (non-negative integer; default 0)',
    },
    totalResults: {
      type: 'boolean',
      description: 'Ask Oracle to include its estimated total matching row count',
    },
    effectiveDate: {
      type: 'string',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: {
    result: {
      type: 'string',
      description: 'Oracle action result; success is reported separately',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_apply_receivables_receipt',
          'oracle_fusion_financials_approve_receivables_invoice',
          'oracle_fusion_financials_submit_expense_report',
        ],
      },
    },
    expenseLine: {
      type: 'json',
      description:
        'Projected expense line (expenseLineUniqId, ExpenseId, ExpenseReportId, ExpenseReference, ExpenseType, ExpenseTypeId, ExpenseTemplate, ExpenseTemplateId, BusinessUnit, OrgId, AssignmentId, PersonId, PersonName, Description)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_line',
          'oracle_fusion_financials_get_expense_line',
          'oracle_fusion_financials_update_expense_line',
        ],
      },
    },
    expenseReport: {
      type: 'json',
      description:
        'Projected expense report (expenseReportUniqId, ExpenseReportId, ExpenseReportNumber, ExpenseReportStatus, ExpenseStatusCode, ExpenseReportTotal, BusinessUnit, OrgId, AssignmentId, PersonId, PersonName, Purpose, ExpenseReportDate, ReportSubmitDate)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_expense_report',
          'oracle_fusion_financials_get_expense_report',
          'oracle_fusion_financials_update_expense_report',
        ],
      },
    },
    receivablesCreditMemo: {
      type: 'json',
      description:
        'Projected receivables credit memo (CustomerTransactionId, TransactionNumber, BusinessUnit, BillToCustomerName, BillToCustomerNumber, BillToSite, TransactionDate, AccountingDate, CreditMemoCurrency, CreditMemoStatus, CreditReason, EnteredAmount, TransactionBalanceDue, FreightCreditAmount)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_credit_memo',
          'oracle_fusion_financials_get_receivables_credit_memo',
        ],
      },
    },
    receivablesInvoice: {
      type: 'json',
      description:
        'Projected receivables invoice (CustomerTransactionId, TransactionNumber, BillToCustomerName, BillToCustomerNumber, BillToSite, BusinessUnit, TransactionDate, AccountingDate, DueDate, InvoiceCurrencyCode, EnteredAmount, InvoiceBalanceAmount, InvoiceStatus, PaymentTerms)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_invoice',
          'oracle_fusion_financials_get_receivables_invoice',
          'oracle_fusion_financials_update_receivables_invoice',
        ],
      },
    },
    receivablesReceipt: {
      type: 'json',
      description:
        'Projected receivables receipt (StandardReceiptId, ReceiptNumber, Amount, AccountedAmount, UnappliedAmount, Currency, BusinessUnit, ReceiptDate, AccountingDate, ReceiptMethod, CustomerName, CustomerAccountNumber, CustomerSite, State)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_create_receivables_receipt',
          'oracle_fusion_financials_get_receivables_receipt',
        ],
      },
    },
    glJournalBatch: {
      type: 'json',
      description:
        'Projected gl journal batch (JeBatchId, BatchName, BatchDescription, DefaultPeriodName, Status, StatusMeaning, CompletionStatusMeaning, ApprovalStatusMeaning, FundsStatusMeaning, UserJeSourceName, ChartOfAccountsName, UserPeriodSetName, AccountedPeriodType, ActualFlagMeaning)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_gl_journal_batch',
      },
    },
    glLedger: {
      type: 'json',
      description:
        'Projected gl ledger (LedgerId, Name, Description, CurrencyCode, ChartOfAccountsId, AccountedPeriodType, PeriodSetName, LedgerCategoryCode, LedgerTypeCode, EnableBudgetaryControlFlag)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_gl_ledger',
      },
    },
    invoice: {
      type: 'json',
      description:
        'The Payables invoice (invoiceUniqId, InvoiceId, InvoiceNumber, Supplier, SupplierNumber, SupplierSite, BusinessUnit, InvoiceAmount, InvoiceCurrency, InvoiceDate, AccountingDate, AmountPaid, PaidStatus, ApprovalStatus)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice',
      },
    },
    invoiceLine: {
      type: 'json',
      description:
        'The Payables invoice line (invoiceLineUniqId, LineNumber, LineType, LineAmount, BaseAmount, Description, Quantity, UOM, UnitPrice, AccountingDate, ApprovalStatus, DiscardedFlag, CanceledFlag, TrackAsAssetFlag)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_line',
      },
    },
    payment: {
      type: 'json',
      description:
        'The Payables payment (CheckId, PaymentId, PaymentReference, PaymentNumber, PaymentAmount, PaymentCurrency, PaymentDate, AccountingDate, Payee, PayeeSite, SupplierNumber, PaymentMethod, PaymentStatus, PaymentType)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment',
      },
    },
    receivablesInvoiceInstallment: {
      type: 'json',
      description:
        'Projected receivables invoice installment (InstallmentId, InstallmentSequenceNumber, InstallmentDueDate, OriginalAmount, InstallmentBalanceDue, AccountedBalanceDue, AmountPaid, InstallmentAmountAdjusted, InstallmentAmountCredited, InstallmentStatus, DisputeAmount, DisputeDate, PaymentDaysLate, CreationDate)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_receivables_invoice_installment',
      },
    },
    receivablesInvoiceLine: {
      type: 'json',
      description:
        'Projected receivables invoice line (CustomerTransactionLineId, LineNumber, Description, ItemNumber, MemoLine, LineAmount, Quantity, UnitSellingPrice, UnitOfMeasure, AccountingRule, AccountingRuleDuration, RuleStartDate, RuleEndDate, TaxClassificationCode)',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_receivables_invoice_line',
      },
    },
    items: {
      type: 'array',
      description:
        'One page of the selected resource, with its documented identity, business fields, amounts, dates, and statuses; use hasMore and offset to paginate',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
    },
    count: {
      type: 'number',
      description: 'Number of records in this page',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether Oracle has another page',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
    },
    limit: {
      type: 'number',
      description: 'Page size returned by Oracle',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
    },
    offset: {
      type: 'number',
      description: 'Offset returned by Oracle',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
    },
    totalResults: {
      type: 'number',
      description: 'Estimated total matching records when requested',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_expense_lines',
          'oracle_fusion_financials_list_expense_reports',
          'oracle_fusion_financials_list_gl_balances',
          'oracle_fusion_financials_list_gl_journal_batches',
          'oracle_fusion_financials_list_gl_ledgers',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_receivables_credit_memos',
          'oracle_fusion_financials_list_receivables_invoice_installments',
          'oracle_fusion_financials_list_receivables_invoice_lines',
          'oracle_fusion_financials_list_receivables_invoices',
          'oracle_fusion_financials_list_receivables_receipts',
        ],
      },
    },
  },
}

export const OracleFusionFinancialsBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/erp/financials/',
  templates: [
    {
      icon: OracleIcon,
      title: 'Payables invoice review',
      prompt:
        'Build a scheduled workflow that lists a bounded page of Oracle Fusion payables invoices, reads the lines of selected invoices, and summarizes approval status, validation status, amounts, and supplier details.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Payables payment report',
      prompt:
        'Build a workflow that lists Oracle Fusion payables payments for a documented date filter and reports payment amounts, currencies, methods, and reconciliation flags.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Receivables invoice creation',
      prompt:
        'Build a workflow that creates an Oracle Fusion receivables invoice from approved billing details and line items, then reads the created invoice to report its number, balance, and status.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Receipt application',
      prompt:
        'Build a workflow that reads a receivables invoice and its installments, creates a standard receipt from approved payment details, and applies an explicitly supplied amount to the selected installment.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Credit memo creation',
      prompt:
        'Build a workflow that creates an Oracle Fusion receivables credit memo from approved customer, transaction, and line details, then reads the resulting memo.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Expense report submission',
      prompt:
        'Build a workflow that creates an Oracle Fusion expense report, adds validated expense lines with employee and business-unit identifiers, submits the report, and checks whether Oracle accepted submission without errors.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Ledger balance report',
      prompt:
        'Build a workflow that lists Oracle Fusion ledgers and queries ledger balances using a documented finder, then summarizes the returned balance amounts for the selected accounting period.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'review-fusion-payables',
      description: 'Review invoice and payment status in Oracle Fusion.',
      content:
        '# Review Fusion Payables\n\n## Steps\n1. List Payables Invoices with documented filters for the desired period or supplier.\n2. Read selected invoices and their invoice lines using the returned opaque keys.\n3. List Payables Payments with a documented filter when payment details are needed.\n4. Continue only the bounded pages needed, advancing offset by the returned count while hasMore is true.\n\n## Output\nReport supplier, invoice number, amounts, currencies, approval status, and payment status. Do not infer a payment-to-invoice relationship from matching amounts.',
    },
    {
      name: 'apply-fusion-receipt',
      description: 'Create and apply a standard receipt to a receivables installment.',
      content:
        '# Apply a Fusion Receipt\n\n## Steps\n1. Get the target receivables invoice and list its installments to obtain the exact InstallmentId.\n2. Create a receipt using the confirmed business unit, currency, receipt method, date, amount, and customer details.\n3. Apply Receivables Receipt using its StandardReceiptId, the selected InstallmentId, and the approved amountApplied.\n4. Read the receipt and invoice again to report the resulting balances.\n\n## Guidance\nUse the correct customer and currency. Only SUCCESS means the action succeeded. A missing amountApplied requests the full open transaction balance; supply an amount when applying a partial receipt.',
    },
    {
      name: 'submit-fusion-expenses',
      description: 'Create and submit an expense report with its expense lines.',
      content:
        '# Submit Fusion Expenses\n\n## Steps\n1. Create Expense Report with the authorized organization and employee details.\n2. Use the returned expenseReportUniqId to create expense lines with their required assignment, organization, person, and ticket-class fields.\n3. Read the report and lines and address validation errors.\n4. Submit Expense Report and confirm the action result is S.\n\n## Output\nReturn the report number, total, status, and validation errors. Submission does not mean approval or payment.',
    },
    {
      name: 'report-fusion-ledger-balances',
      description: 'Read ledger and accounting-period balances.',
      content:
        '# Report Fusion Ledger Balances\n\n## Steps\n1. List GL Ledgers and select the correct ledger.\n2. List GL Balances using the documented finder and accounting-period arguments for that ledger.\n3. Page only as needed and retain the currency and accounting period alongside every amount.\n4. Read journal batches separately when batch approval and posting status is relevant.\n\n## Output\nReturn the ledger, period, currency, and documented balance values. Keep currencies separate and do not infer posting from the existence of a batch.',
    },
  ],
} as const satisfies BlockMeta
