/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import {
  executeOracleFusionFinancialsOperation,
  type OracleFusionFinancialsToolId,
} from '@/lib/internal/oracle-fusion-financials/operations'
import {
  ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
  ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
  ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
  ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
  ORACLE_FUSION_EXPENSE_LINE_ERROR_FIELDS,
  ORACLE_FUSION_EXPENSE_LINE_FIELDS,
  ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
  ORACLE_FUSION_EXPENSE_REPORT_PAYMENT_FIELDS,
  ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS,
  ORACLE_FUSION_GL_BALANCE_FIELDS,
  ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS,
  ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS,
  ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS,
  ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS,
  ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS,
  ORACLE_FUSION_GL_LEDGER_FIELDS,
  ORACLE_FUSION_INSTALLMENT_FIELDS,
  ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
  ORACLE_FUSION_INVOICE_FIELDS,
  ORACLE_FUSION_INVOICE_HOLD_FIELDS,
  ORACLE_FUSION_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_PAYMENT_FIELDS,
  ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
  ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
  ORACLE_FUSION_PAYMENT_TERM_FIELDS,
  ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_APPLICATION_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_RECEIPT_APPLICATION_FIELDS,
  ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
  ORACLE_FUSION_RECEIVABLES_TRANSACTION_ADJUSTMENT_FIELDS,
  ORACLE_FUSION_RECEIVABLES_TRANSACTION_PAYMENT_SCHEDULE_FIELDS,
} from '@/lib/internal/oracle-fusion-financials/schema'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const RESOURCE_PATH = '/fscmRestApi/resources/11.13.18.05'
const AUTH = {
  oauthCredential: 'credential-id',
  accessToken: Buffer.from('integration-user:password').toString('base64'),
  instanceUrl: ORIGIN,
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
    arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
  }
}

function page(
  items: unknown[],
  options: { limit?: number; offset?: number; totalResults?: number } = {}
) {
  return {
    items,
    count: items.length,
    hasMore: false,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    ...(options.totalResults === undefined ? {} : { totalResults: options.totalResults }),
  }
}

function selfLink(path: string) {
  return [{ rel: 'self', href: `${ORIGIN}${path}` }]
}

function item(path: string, values: Record<string, unknown> = {}) {
  return { ...values, UnexpectedFlexfield: 'must not escape', links: selfLink(path) }
}

interface OperationCase {
  name: string
  toolId: OracleFusionFinancialsToolId
  path: string
  fields: readonly string[]
  input?: Record<string, unknown>
  wrapper?: string
  item: Record<string, unknown>
  derivedKey?: { name: string; value: string }
}

const INVOICE_PATH = `${RESOURCE_PATH}/invoices/INVOICEKEY`
const LINE_COLLECTION_PATH = `${INVOICE_PATH}/child/invoiceLines`
const LINE_PATH = `${LINE_COLLECTION_PATH}/LINEKEY`
const INSTALLMENT_COLLECTION_PATH = `${INVOICE_PATH}/child/invoiceInstallments`
const INSTALLMENT_PATH = `${INSTALLMENT_COLLECTION_PATH}/INSTALLMENTKEY`
const DISTRIBUTION_COLLECTION_PATH = `${LINE_PATH}/child/invoiceDistributions`
const APPLIED_COLLECTION_PATH = `${INVOICE_PATH}/child/appliedPrepayments`
const AVAILABLE_COLLECTION_PATH = `${INVOICE_PATH}/child/availablePrepayments`
const PAYMENT_PATH = `${RESOURCE_PATH}/payablesPayments/42`
const RELATED_COLLECTION_PATH = `${PAYMENT_PATH}/child/relatedInvoices`
const TERM_PATH = `${RESOURCE_PATH}/payablesPaymentTerms/73`
const TERM_LINE_COLLECTION_PATH = `${TERM_PATH}/child/payablesPaymentTermsLines`

const OPERATION_CASES: OperationCase[] = [
  {
    name: 'list receivables invoice',
    toolId: 'oracle_fusion_financials_list_receivables_invoices',
    path: `${RESOURCE_PATH}/receivablesInvoices`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
    item: item(`${RESOURCE_PATH}/receivablesInvoices/42`, {
      CustomerTransactionId: '42',
    }),
  },
  {
    name: 'get receivables invoice',
    toolId: 'oracle_fusion_financials_get_receivables_invoice',
    path: `${RESOURCE_PATH}/receivablesInvoices/42`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
    input: {
      receivablesInvoiceId: '42',
    },
    wrapper: 'receivablesInvoice',
    item: item(`${RESOURCE_PATH}/receivablesInvoices/42`, {
      CustomerTransactionId: '42',
    }),
  },
  {
    name: 'list receivables invoice line',
    toolId: 'oracle_fusion_financials_list_receivables_invoice_lines',
    path: `${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceLines`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
    input: {
      receivablesInvoiceId: '11',
    },
    item: item(`${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceLines/42`, {
      CustomerTransactionLineId: '42',
    }),
  },
  {
    name: 'get receivables invoice line',
    toolId: 'oracle_fusion_financials_get_receivables_invoice_line',
    path: `${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceLines/42`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
    input: {
      receivablesInvoiceId: '11',
      receivablesInvoiceLineId: '42',
    },
    wrapper: 'receivablesInvoiceLine',
    item: item(`${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceLines/42`, {
      CustomerTransactionLineId: '42',
    }),
  },
  {
    name: 'list receivables invoice distribution',
    toolId: 'oracle_fusion_financials_list_receivables_invoice_distributions',
    path: `${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceDistributions`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS,
    input: {
      receivablesInvoiceId: '11',
    },
    item: item(`${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceDistributions/42`, {
      DistributionId: '42',
    }),
  },
  {
    name: 'get receivables invoice distribution',
    toolId: 'oracle_fusion_financials_get_receivables_invoice_distribution',
    path: `${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceDistributions/42`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS,
    input: {
      receivablesInvoiceId: '11',
      receivablesInvoiceDistributionId: '42',
    },
    wrapper: 'receivablesInvoiceDistribution',
    item: item(`${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceDistributions/42`, {
      DistributionId: '42',
    }),
  },
  {
    name: 'list receivables invoice installment',
    toolId: 'oracle_fusion_financials_list_receivables_invoice_installments',
    path: `${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceInstallments`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
    input: {
      receivablesInvoiceId: '11',
    },
    item: item(`${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceInstallments/42`, {
      InstallmentId: '42',
    }),
  },
  {
    name: 'get receivables invoice installment',
    toolId: 'oracle_fusion_financials_get_receivables_invoice_installment',
    path: `${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceInstallments/42`,
    fields: ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
    input: {
      receivablesInvoiceId: '11',
      receivablesInvoiceInstallmentId: '42',
    },
    wrapper: 'receivablesInvoiceInstallment',
    item: item(`${RESOURCE_PATH}/receivablesInvoices/11/child/receivablesInvoiceInstallments/42`, {
      InstallmentId: '42',
    }),
  },
  {
    name: 'list receivables credit memo',
    toolId: 'oracle_fusion_financials_list_receivables_credit_memos',
    path: `${RESOURCE_PATH}/receivablesCreditMemos`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
    item: item(`${RESOURCE_PATH}/receivablesCreditMemos/42`, {
      CustomerTransactionId: '42',
    }),
  },
  {
    name: 'get receivables credit memo',
    toolId: 'oracle_fusion_financials_get_receivables_credit_memo',
    path: `${RESOURCE_PATH}/receivablesCreditMemos/42`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
    input: {
      receivablesCreditMemoId: '42',
    },
    wrapper: 'receivablesCreditMemo',
    item: item(`${RESOURCE_PATH}/receivablesCreditMemos/42`, {
      CustomerTransactionId: '42',
    }),
  },
  {
    name: 'list receivables credit memo line',
    toolId: 'oracle_fusion_financials_list_receivables_credit_memo_lines',
    path: `${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoLines`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS,
    input: {
      receivablesCreditMemoId: '11',
    },
    item: item(`${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoLines/42`, {
      CustomerTransactionLineId: '42',
    }),
  },
  {
    name: 'get receivables credit memo line',
    toolId: 'oracle_fusion_financials_get_receivables_credit_memo_line',
    path: `${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoLines/42`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS,
    input: {
      receivablesCreditMemoId: '11',
      receivablesCreditMemoLineId: '42',
    },
    wrapper: 'receivablesCreditMemoLine',
    item: item(`${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoLines/42`, {
      CustomerTransactionLineId: '42',
    }),
  },
  {
    name: 'list receivables credit memo distribution',
    toolId: 'oracle_fusion_financials_list_receivables_credit_memo_distributions',
    path: `${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoDistributions`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS,
    input: {
      receivablesCreditMemoId: '11',
    },
    item: item(
      `${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoDistributions/42`,
      {
        DistributionId: '42',
      }
    ),
  },
  {
    name: 'get receivables credit memo distribution',
    toolId: 'oracle_fusion_financials_get_receivables_credit_memo_distribution',
    path: `${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoDistributions/42`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS,
    input: {
      receivablesCreditMemoId: '11',
      receivablesCreditMemoDistributionId: '42',
    },
    wrapper: 'receivablesCreditMemoDistribution',
    item: item(
      `${RESOURCE_PATH}/receivablesCreditMemos/11/child/receivablesCreditMemoDistributions/42`,
      {
        DistributionId: '42',
      }
    ),
  },
  {
    name: 'list receivables receipt',
    toolId: 'oracle_fusion_financials_list_receivables_receipts',
    path: `${RESOURCE_PATH}/standardReceipts`,
    fields: ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
    item: item(`${RESOURCE_PATH}/standardReceipts/42`, {
      StandardReceiptId: '42',
    }),
  },
  {
    name: 'get receivables receipt',
    toolId: 'oracle_fusion_financials_get_receivables_receipt',
    path: `${RESOURCE_PATH}/standardReceipts/42`,
    fields: ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
    input: {
      receivablesReceiptId: '42',
    },
    wrapper: 'receivablesReceipt',
    item: item(`${RESOURCE_PATH}/standardReceipts/42`, {
      StandardReceiptId: '42',
    }),
  },
  {
    name: 'list receivables customer account',
    toolId: 'oracle_fusion_financials_list_receivables_customer_accounts',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities`,
    fields: ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS,
    item: item(`${RESOURCE_PATH}/receivablesCustomerAccountActivities/42`, {
      AccountId: '42',
    }),
  },
  {
    name: 'get receivables customer account',
    toolId: 'oracle_fusion_financials_get_receivables_customer_account',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/42`,
    fields: ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS,
    input: {
      receivablesCustomerAccountId: '42',
    },
    wrapper: 'receivablesCustomerAccount',
    item: item(`${RESOURCE_PATH}/receivablesCustomerAccountActivities/42`, {
      AccountId: '42',
    }),
  },
  {
    name: 'list receivables customer account site',
    toolId: 'oracle_fusion_financials_list_receivables_customer_account_sites',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountSiteActivities`,
    fields: ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS,
    item: item(`${RESOURCE_PATH}/receivablesCustomerAccountSiteActivities/42`, {
      BillToSiteUseId: '42',
    }),
  },
  {
    name: 'get receivables customer account site',
    toolId: 'oracle_fusion_financials_get_receivables_customer_account_site',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountSiteActivities/42`,
    fields: ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS,
    input: {
      receivablesCustomerAccountSiteId: '42',
    },
    wrapper: 'receivablesCustomerAccountSite',
    item: item(`${RESOURCE_PATH}/receivablesCustomerAccountSiteActivities/42`, {
      BillToSiteUseId: '42',
    }),
  },
  {
    name: 'list receivables receipt application',
    toolId: 'oracle_fusion_financials_list_receivables_receipt_applications',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/standardReceiptApplications`,
    fields: ORACLE_FUSION_RECEIVABLES_RECEIPT_APPLICATION_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
    },
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/standardReceiptApplications/42`,
      {
        ApplicationId: '42',
      }
    ),
  },
  {
    name: 'get receivables receipt application',
    toolId: 'oracle_fusion_financials_get_receivables_receipt_application',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/standardReceiptApplications/42`,
    fields: ORACLE_FUSION_RECEIVABLES_RECEIPT_APPLICATION_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
      receivablesReceiptApplicationId: '42',
    },
    wrapper: 'receivablesReceiptApplication',
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/standardReceiptApplications/42`,
      {
        ApplicationId: '42',
      }
    ),
  },
  {
    name: 'list receivables credit memo application',
    toolId: 'oracle_fusion_financials_list_receivables_credit_memo_applications',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/creditMemoApplications`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_APPLICATION_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
    },
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/creditMemoApplications/42`,
      {
        ApplicationId: '42',
      }
    ),
  },
  {
    name: 'get receivables credit memo application',
    toolId: 'oracle_fusion_financials_get_receivables_credit_memo_application',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/creditMemoApplications/42`,
    fields: ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_APPLICATION_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
      receivablesCreditMemoApplicationId: '42',
    },
    wrapper: 'receivablesCreditMemoApplication',
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/creditMemoApplications/42`,
      {
        ApplicationId: '42',
      }
    ),
  },
  {
    name: 'list receivables transaction payment schedule',
    toolId: 'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionPaymentSchedules`,
    fields: ORACLE_FUSION_RECEIVABLES_TRANSACTION_PAYMENT_SCHEDULE_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
    },
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionPaymentSchedules/42`,
      {
        InstallmentId: '42',
      }
    ),
  },
  {
    name: 'get receivables transaction payment schedule',
    toolId: 'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionPaymentSchedules/42`,
    fields: ORACLE_FUSION_RECEIVABLES_TRANSACTION_PAYMENT_SCHEDULE_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
      receivablesTransactionPaymentScheduleId: '42',
    },
    wrapper: 'receivablesTransactionPaymentSchedule',
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionPaymentSchedules/42`,
      {
        InstallmentId: '42',
      }
    ),
  },
  {
    name: 'list receivables transaction adjustment',
    toolId: 'oracle_fusion_financials_list_receivables_transaction_adjustments',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionAdjustments`,
    fields: ORACLE_FUSION_RECEIVABLES_TRANSACTION_ADJUSTMENT_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
    },
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionAdjustments/42`,
      {
        AdjustmentId: '42',
      }
    ),
  },
  {
    name: 'get receivables transaction adjustment',
    toolId: 'oracle_fusion_financials_get_receivables_transaction_adjustment',
    path: `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionAdjustments/42`,
    fields: ORACLE_FUSION_RECEIVABLES_TRANSACTION_ADJUSTMENT_FIELDS,
    input: {
      receivablesCustomerAccountId: '11',
      receivablesTransactionAdjustmentId: '42',
    },
    wrapper: 'receivablesTransactionAdjustment',
    item: item(
      `${RESOURCE_PATH}/receivablesCustomerAccountActivities/11/child/transactionAdjustments/42`,
      {
        AdjustmentId: '42',
      }
    ),
  },
  {
    name: 'list expense report',
    toolId: 'oracle_fusion_financials_list_expense_reports',
    path: `${RESOURCE_PATH}/expenseReports`,
    fields: ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
    item: item(`${RESOURCE_PATH}/expenseReports/RESOURCEKEY`, {
      ExpenseReportId: '42',
    }),
    derivedKey: { name: 'expenseReportUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get expense report',
    toolId: 'oracle_fusion_financials_get_expense_report',
    path: `${RESOURCE_PATH}/expenseReports/RESOURCEKEY`,
    fields: ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
    input: {
      expenseReportUniqId: 'RESOURCEKEY',
    },
    wrapper: 'expenseReport',
    item: item(`${RESOURCE_PATH}/expenseReports/RESOURCEKEY`, {
      ExpenseReportId: '42',
    }),
    derivedKey: { name: 'expenseReportUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list expense line',
    toolId: 'oracle_fusion_financials_list_expense_lines',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense`,
    fields: ORACLE_FUSION_EXPENSE_LINE_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
    },
    item: item(`${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/RESOURCEKEY`, {
      ExpenseId: '42',
    }),
    derivedKey: { name: 'expenseLineUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get expense line',
    toolId: 'oracle_fusion_financials_get_expense_line',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/RESOURCEKEY`,
    fields: ORACLE_FUSION_EXPENSE_LINE_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'RESOURCEKEY',
    },
    wrapper: 'expenseLine',
    item: item(`${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/RESOURCEKEY`, {
      ExpenseId: '42',
    }),
    derivedKey: { name: 'expenseLineUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list expense distribution',
    toolId: 'oracle_fusion_financials_list_expense_distributions',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseDistribution`,
    fields: ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'PARENTKEY1',
    },
    item: item(
      `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseDistribution/42`,
      {
        ExpenseDistId: '42',
      }
    ),
  },
  {
    name: 'get expense distribution',
    toolId: 'oracle_fusion_financials_get_expense_distribution',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseDistribution/42`,
    fields: ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'PARENTKEY1',
      expenseDistributionId: '42',
    },
    wrapper: 'expenseDistribution',
    item: item(
      `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseDistribution/42`,
      {
        ExpenseDistId: '42',
      }
    ),
  },
  {
    name: 'list expense itemization',
    toolId: 'oracle_fusion_financials_list_expense_itemizations',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseItemization`,
    fields: ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'PARENTKEY1',
    },
    item: item(
      `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseItemization/42`,
      {
        ExpenseId: '42',
      }
    ),
  },
  {
    name: 'get expense itemization',
    toolId: 'oracle_fusion_financials_get_expense_itemization',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseItemization/42`,
    fields: ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'PARENTKEY1',
      expenseItemizationId: '42',
    },
    wrapper: 'expenseItemization',
    item: item(
      `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/ExpenseItemization/42`,
      {
        ExpenseId: '42',
      }
    ),
  },
  {
    name: 'list expense report processing detail',
    toolId: 'oracle_fusion_financials_list_expense_report_processing_details',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/processingDetails`,
    fields: ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
    },
    item: item(`${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/processingDetails/RESOURCEKEY`, {
      ExpenseReportProcessingId: 42,
    }),
    derivedKey: { name: 'expenseReportProcessingDetailUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get expense report processing detail',
    toolId: 'oracle_fusion_financials_get_expense_report_processing_detail',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/processingDetails/RESOURCEKEY`,
    fields: ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseReportProcessingDetailUniqId: 'RESOURCEKEY',
    },
    wrapper: 'expenseReportProcessingDetail',
    item: item(`${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/processingDetails/RESOURCEKEY`, {
      ExpenseReportProcessingId: 42,
    }),
    derivedKey: { name: 'expenseReportProcessingDetailUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list expense report payment',
    toolId: 'oracle_fusion_financials_list_expense_report_payments',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/ExpensePayment`,
    fields: ORACLE_FUSION_EXPENSE_REPORT_PAYMENT_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
    },
    item: item(`${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/ExpensePayment/42`, {
      ExpenseReportId: '42',
    }),
  },
  {
    name: 'get expense report payment',
    toolId: 'oracle_fusion_financials_get_expense_report_payment',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/ExpensePayment/42`,
    fields: ORACLE_FUSION_EXPENSE_REPORT_PAYMENT_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseReportPaymentId: '42',
    },
    wrapper: 'expenseReportPayment',
    item: item(`${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/ExpensePayment/42`, {
      ExpenseReportId: '42',
    }),
  },
  {
    name: 'list expense line error',
    toolId: 'oracle_fusion_financials_list_expense_line_errors',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/expenseErrors`,
    fields: ORACLE_FUSION_EXPENSE_LINE_ERROR_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'PARENTKEY1',
    },
    item: item(
      `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/expenseErrors/42`,
      {
        ErrorSequence: 42,
      }
    ),
  },
  {
    name: 'get expense line error',
    toolId: 'oracle_fusion_financials_get_expense_line_error',
    path: `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/expenseErrors/42`,
    fields: ORACLE_FUSION_EXPENSE_LINE_ERROR_FIELDS,
    input: {
      expenseReportUniqId: 'PARENTKEY0',
      expenseLineUniqId: 'PARENTKEY1',
      expenseLineErrorSequence: '42',
    },
    wrapper: 'expenseLineError',
    item: item(
      `${RESOURCE_PATH}/expenseReports/PARENTKEY0/child/Expense/PARENTKEY1/child/expenseErrors/42`,
      {
        ErrorSequence: 42,
      }
    ),
  },
  {
    name: 'list gl ledger',
    toolId: 'oracle_fusion_financials_list_gl_ledgers',
    path: `${RESOURCE_PATH}/ledgersLOV`,
    fields: ORACLE_FUSION_GL_LEDGER_FIELDS,
    item: item(`${RESOURCE_PATH}/ledgersLOV/42`, {
      LedgerId: '42',
    }),
  },
  {
    name: 'get gl ledger',
    toolId: 'oracle_fusion_financials_get_gl_ledger',
    path: `${RESOURCE_PATH}/ledgersLOV/42`,
    fields: ORACLE_FUSION_GL_LEDGER_FIELDS,
    input: {
      glLedgerId: '42',
    },
    wrapper: 'glLedger',
    item: item(`${RESOURCE_PATH}/ledgersLOV/42`, {
      LedgerId: '42',
    }),
  },
  {
    name: 'list gl journal batch',
    toolId: 'oracle_fusion_financials_list_gl_journal_batches',
    path: `${RESOURCE_PATH}/journalBatches`,
    fields: ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS,
    item: item(`${RESOURCE_PATH}/journalBatches/42`, {
      JeBatchId: '42',
    }),
  },
  {
    name: 'get gl journal batch',
    toolId: 'oracle_fusion_financials_get_gl_journal_batch',
    path: `${RESOURCE_PATH}/journalBatches/42`,
    fields: ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS,
    input: {
      glJournalBatchId: '42',
    },
    wrapper: 'glJournalBatch',
    item: item(`${RESOURCE_PATH}/journalBatches/42`, {
      JeBatchId: '42',
    }),
  },
  {
    name: 'list gl journal header',
    toolId: 'oracle_fusion_financials_list_gl_journal_headers',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalHeaders`,
    fields: ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS,
    input: {
      glJournalBatchId: '11',
    },
    item: item(`${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/RESOURCEKEY`, {
      JournalName: 'Example',
    }),
    derivedKey: { name: 'glJournalHeaderUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get gl journal header',
    toolId: 'oracle_fusion_financials_get_gl_journal_header',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/RESOURCEKEY`,
    fields: ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS,
    input: {
      glJournalBatchId: '11',
      glJournalHeaderUniqId: 'RESOURCEKEY',
    },
    wrapper: 'glJournalHeader',
    item: item(`${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/RESOURCEKEY`, {
      JournalName: 'Example',
    }),
    derivedKey: { name: 'glJournalHeaderUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list gl journal line',
    toolId: 'oracle_fusion_financials_list_gl_journal_lines',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/PARENTKEY1/child/journalLines`,
    fields: ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS,
    input: {
      glJournalBatchId: '11',
      glJournalHeaderUniqId: 'PARENTKEY1',
    },
    item: item(
      `${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/PARENTKEY1/child/journalLines/RESOURCEKEY`,
      {
        JeLineNumber: '42',
      }
    ),
    derivedKey: { name: 'glJournalLineUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get gl journal line',
    toolId: 'oracle_fusion_financials_get_gl_journal_line',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/PARENTKEY1/child/journalLines/RESOURCEKEY`,
    fields: ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS,
    input: {
      glJournalBatchId: '11',
      glJournalHeaderUniqId: 'PARENTKEY1',
      glJournalLineUniqId: 'RESOURCEKEY',
    },
    wrapper: 'glJournalLine',
    item: item(
      `${RESOURCE_PATH}/journalBatches/11/child/journalHeaders/PARENTKEY1/child/journalLines/RESOURCEKEY`,
      {
        JeLineNumber: '42',
      }
    ),
    derivedKey: { name: 'glJournalLineUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list gl journal error',
    toolId: 'oracle_fusion_financials_list_gl_journal_errors',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalErrors`,
    fields: ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS,
    input: {
      glJournalBatchId: '11',
    },
    item: item(`${RESOURCE_PATH}/journalBatches/11/child/journalErrors/RESOURCEKEY`, {
      ErrorNumber: '42',
    }),
    derivedKey: { name: 'glJournalErrorUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get gl journal error',
    toolId: 'oracle_fusion_financials_get_gl_journal_error',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalErrors/RESOURCEKEY`,
    fields: ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS,
    input: {
      glJournalBatchId: '11',
      glJournalErrorUniqId: 'RESOURCEKEY',
    },
    wrapper: 'glJournalError',
    item: item(`${RESOURCE_PATH}/journalBatches/11/child/journalErrors/RESOURCEKEY`, {
      ErrorNumber: '42',
    }),
    derivedKey: { name: 'glJournalErrorUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list gl journal action log',
    toolId: 'oracle_fusion_financials_list_gl_journal_action_logs',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalActionLogs`,
    fields: ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS,
    input: {
      glJournalBatchId: '11',
    },
    item: item(`${RESOURCE_PATH}/journalBatches/11/child/journalActionLogs/RESOURCEKEY`, {
      ActionCodeMeaning: 'Example',
    }),
    derivedKey: { name: 'glJournalActionLogUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'get gl journal action log',
    toolId: 'oracle_fusion_financials_get_gl_journal_action_log',
    path: `${RESOURCE_PATH}/journalBatches/11/child/journalActionLogs/RESOURCEKEY`,
    fields: ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS,
    input: {
      glJournalBatchId: '11',
      glJournalActionLogUniqId: 'RESOURCEKEY',
    },
    wrapper: 'glJournalActionLog',
    item: item(`${RESOURCE_PATH}/journalBatches/11/child/journalActionLogs/RESOURCEKEY`, {
      ActionCodeMeaning: 'Example',
    }),
    derivedKey: { name: 'glJournalActionLogUniqId', value: 'RESOURCEKEY' },
  },
  {
    name: 'list gl balance',
    toolId: 'oracle_fusion_financials_list_gl_balances',
    path: `${RESOURCE_PATH}/ledgerBalances`,
    fields: ORACLE_FUSION_GL_BALANCE_FIELDS,
    item: item(`${RESOURCE_PATH}/ledgerBalances`, {
      ActualBalance: '#MISSING',
      EndingBalance: 'N/A',
      BeginningBalance: null,
    }),
  },
  {
    name: 'list invoices',
    toolId: 'oracle_fusion_financials_list_payables_invoices',
    path: `${RESOURCE_PATH}/invoices`,
    fields: ORACLE_FUSION_INVOICE_FIELDS,
    item: item(INVOICE_PATH, { InvoiceId: 1, InvoiceNumber: 'INV-1' }),
    derivedKey: { name: 'invoiceUniqId', value: 'INVOICEKEY' },
  },
  {
    name: 'get invoice',
    toolId: 'oracle_fusion_financials_get_payables_invoice',
    path: INVOICE_PATH,
    fields: ORACLE_FUSION_INVOICE_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    wrapper: 'invoice',
    item: item(INVOICE_PATH, { InvoiceId: 1, InvoiceNumber: 'INV-1' }),
    derivedKey: { name: 'invoiceUniqId', value: 'INVOICEKEY' },
  },
  {
    name: 'list invoice lines',
    toolId: 'oracle_fusion_financials_list_payables_invoice_lines',
    path: LINE_COLLECTION_PATH,
    fields: ORACLE_FUSION_INVOICE_LINE_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(LINE_PATH, { LineNumber: 1, LineAmount: 12.5 }),
    derivedKey: { name: 'invoiceLineUniqId', value: 'LINEKEY' },
  },
  {
    name: 'get invoice line',
    toolId: 'oracle_fusion_financials_get_payables_invoice_line',
    path: LINE_PATH,
    fields: ORACLE_FUSION_INVOICE_LINE_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY' },
    wrapper: 'invoiceLine',
    item: item(LINE_PATH, { LineNumber: 1, LineAmount: 12.5 }),
    derivedKey: { name: 'invoiceLineUniqId', value: 'LINEKEY' },
  },
  {
    name: 'list invoice installments',
    toolId: 'oracle_fusion_financials_list_payables_invoice_installments',
    path: INSTALLMENT_COLLECTION_PATH,
    fields: ORACLE_FUSION_INSTALLMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(INSTALLMENT_PATH, { InstallmentNumber: 1, DueDate: '2026-09-30' }),
    derivedKey: { name: 'invoiceInstallmentUniqId', value: 'INSTALLMENTKEY' },
  },
  {
    name: 'get invoice installment',
    toolId: 'oracle_fusion_financials_get_payables_invoice_installment',
    path: INSTALLMENT_PATH,
    fields: ORACLE_FUSION_INSTALLMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', invoiceInstallmentUniqId: 'INSTALLMENTKEY' },
    wrapper: 'invoiceInstallment',
    item: item(INSTALLMENT_PATH, { InstallmentNumber: 1, DueDate: '2026-09-30' }),
    derivedKey: { name: 'invoiceInstallmentUniqId', value: 'INSTALLMENTKEY' },
  },
  {
    name: 'list invoice distributions',
    toolId: 'oracle_fusion_financials_list_payables_invoice_distributions',
    path: DISTRIBUTION_COLLECTION_PATH,
    fields: ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY' },
    item: item(`${DISTRIBUTION_COLLECTION_PATH}/99`, { InvoiceDistributionId: 99 }),
  },
  {
    name: 'get invoice distribution',
    toolId: 'oracle_fusion_financials_get_payables_invoice_distribution',
    path: `${DISTRIBUTION_COLLECTION_PATH}/99`,
    fields: ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
    input: {
      invoiceUniqId: 'INVOICEKEY',
      invoiceLineUniqId: 'LINEKEY',
      invoiceDistributionId: '99',
    },
    wrapper: 'invoiceDistribution',
    item: item(`${DISTRIBUTION_COLLECTION_PATH}/99`, { InvoiceDistributionId: 99 }),
  },
  {
    name: 'list applied prepayments',
    toolId: 'oracle_fusion_financials_list_payables_applied_prepayments',
    path: APPLIED_COLLECTION_PATH,
    fields: ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(`${APPLIED_COLLECTION_PATH}/APPLIEDKEY`, { AppliedAmount: 40 }),
    derivedKey: { name: 'appliedPrepaymentUniqId', value: 'APPLIEDKEY' },
  },
  {
    name: 'get applied prepayment',
    toolId: 'oracle_fusion_financials_get_payables_applied_prepayment',
    path: `${APPLIED_COLLECTION_PATH}/APPLIEDKEY`,
    fields: ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', appliedPrepaymentUniqId: 'APPLIEDKEY' },
    wrapper: 'appliedPrepayment',
    item: item(`${APPLIED_COLLECTION_PATH}/APPLIEDKEY`, { AppliedAmount: 40 }),
    derivedKey: { name: 'appliedPrepaymentUniqId', value: 'APPLIEDKEY' },
  },
  {
    name: 'list available prepayments',
    toolId: 'oracle_fusion_financials_list_payables_available_prepayments',
    path: AVAILABLE_COLLECTION_PATH,
    fields: ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(`${AVAILABLE_COLLECTION_PATH}/AVAILABLEKEY`, { AvailableAmount: 60 }),
    derivedKey: { name: 'availablePrepaymentUniqId', value: 'AVAILABLEKEY' },
  },
  {
    name: 'get available prepayment',
    toolId: 'oracle_fusion_financials_get_payables_available_prepayment',
    path: `${AVAILABLE_COLLECTION_PATH}/AVAILABLEKEY`,
    fields: ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', availablePrepaymentUniqId: 'AVAILABLEKEY' },
    wrapper: 'availablePrepayment',
    item: item(`${AVAILABLE_COLLECTION_PATH}/AVAILABLEKEY`, { AvailableAmount: 60 }),
    derivedKey: { name: 'availablePrepaymentUniqId', value: 'AVAILABLEKEY' },
  },
  {
    name: 'list payments',
    toolId: 'oracle_fusion_financials_list_payables_payments',
    path: `${RESOURCE_PATH}/payablesPayments`,
    fields: ORACLE_FUSION_PAYMENT_FIELDS,
    item: item(PAYMENT_PATH, { CheckId: 42, PaymentAmount: 100 }),
  },
  {
    name: 'get payment',
    toolId: 'oracle_fusion_financials_get_payables_payment',
    path: PAYMENT_PATH,
    fields: ORACLE_FUSION_PAYMENT_FIELDS,
    input: { checkId: '42' },
    wrapper: 'payment',
    item: item(PAYMENT_PATH, { CheckId: 42, PaymentAmount: 100 }),
  },
  {
    name: 'list payment-related invoices',
    toolId: 'oracle_fusion_financials_list_payables_payment_related_invoices',
    path: RELATED_COLLECTION_PATH,
    fields: ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
    input: { checkId: '42' },
    item: item(`${RELATED_COLLECTION_PATH}/88`, { InvoicePaymentId: 88, CheckId: 42 }),
  },
  {
    name: 'get payment-related invoice',
    toolId: 'oracle_fusion_financials_get_payables_payment_related_invoice',
    path: `${RELATED_COLLECTION_PATH}/88`,
    fields: ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
    input: { checkId: '42', invoicePaymentId: '88' },
    wrapper: 'paymentRelatedInvoice',
    item: item(`${RELATED_COLLECTION_PATH}/88`, { InvoicePaymentId: 88, CheckId: 42 }),
  },
  {
    name: 'list payment process requests',
    toolId: 'oracle_fusion_financials_list_payment_process_requests',
    path: `${RESOURCE_PATH}/paymentProcessRequests`,
    fields: ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
    item: item(`${RESOURCE_PATH}/paymentProcessRequests/17`, { PaymentProcessRequestId: 17 }),
  },
  {
    name: 'get payment process request',
    toolId: 'oracle_fusion_financials_get_payment_process_request',
    path: `${RESOURCE_PATH}/paymentProcessRequests/17`,
    fields: ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
    input: { paymentProcessRequestId: '17' },
    wrapper: 'paymentProcessRequest',
    item: item(`${RESOURCE_PATH}/paymentProcessRequests/17`, { PaymentProcessRequestId: 17 }),
  },
  {
    name: 'list invoice holds',
    toolId: 'oracle_fusion_financials_list_payables_invoice_holds',
    path: `${RESOURCE_PATH}/invoiceHolds`,
    fields: ORACLE_FUSION_INVOICE_HOLD_FIELDS,
    item: item(`${RESOURCE_PATH}/invoiceHolds/21`, { HoldId: 21, HoldName: 'Amount' }),
  },
  {
    name: 'get invoice hold',
    toolId: 'oracle_fusion_financials_get_payables_invoice_hold',
    path: `${RESOURCE_PATH}/invoiceHolds/21`,
    fields: ORACLE_FUSION_INVOICE_HOLD_FIELDS,
    input: { holdId: '21' },
    wrapper: 'invoiceHold',
    item: item(`${RESOURCE_PATH}/invoiceHolds/21`, { HoldId: 21, HoldName: 'Amount' }),
  },
  {
    name: 'list payment terms',
    toolId: 'oracle_fusion_financials_list_payables_payment_terms',
    path: `${RESOURCE_PATH}/payablesPaymentTerms`,
    fields: ORACLE_FUSION_PAYMENT_TERM_FIELDS,
    item: item(TERM_PATH, { termsId: 73, name: 'Net 30' }),
  },
  {
    name: 'get payment term',
    toolId: 'oracle_fusion_financials_get_payables_payment_term',
    path: TERM_PATH,
    fields: ORACLE_FUSION_PAYMENT_TERM_FIELDS,
    input: { termsId: '73' },
    wrapper: 'paymentTerm',
    item: item(TERM_PATH, { termsId: 73, name: 'Net 30' }),
  },
  {
    name: 'list payment term lines',
    toolId: 'oracle_fusion_financials_list_payables_payment_term_lines',
    path: TERM_LINE_COLLECTION_PATH,
    fields: ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
    input: { termsId: '73' },
    item: item(`${TERM_LINE_COLLECTION_PATH}/TERMLINEKEY`, { termsId: 73, sequenceNumber: 1 }),
    derivedKey: { name: 'paymentTermLineUniqId', value: 'TERMLINEKEY' },
  },
  {
    name: 'get payment term line',
    toolId: 'oracle_fusion_financials_get_payables_payment_term_line',
    path: `${TERM_LINE_COLLECTION_PATH}/TERMLINEKEY`,
    fields: ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
    input: { termsId: '73', paymentTermLineUniqId: 'TERMLINEKEY' },
    wrapper: 'paymentTermLine',
    item: item(`${TERM_LINE_COLLECTION_PATH}/TERMLINEKEY`, { termsId: 73, sequenceNumber: 1 }),
    derivedKey: { name: 'paymentTermLineUniqId', value: 'TERMLINEKEY' },
  },
]

describe('Oracle Fusion Financials operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSecureFetch.mockReset()
    mockValidateUrl.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.25',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
  })

  it('keeps journal child keys distinct from display numbers across lookup steps', async () => {
    const batchPath = `${RESOURCE_PATH}/journalBatches/42`
    const headerPath = `${batchPath}/child/journalHeaders/%20header%252Fkey%20`
    const linePath = `${headerPath}/child/journalLines/%20line%20key%20`
    const modernItem = (path: string, values: Record<string, unknown>) => ({
      ...values,
      '@context': { links: selfLink(path), key: 'not-the-resource-key' },
    })
    mockSecureFetch
      .mockResolvedValueOnce(
        response(200, page([modernItem(headerPath, { JournalName: 'Accrual' })]))
      )
      .mockResolvedValueOnce(response(200, page([modernItem(linePath, { JeLineNumber: 10 })])))
      .mockResolvedValueOnce(response(200, modernItem(linePath, { JeLineNumber: 10 })))
    const headers = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_gl_journal_headers',
      { ...AUTH, glJournalBatchId: '42' }
    )
    const glJournalHeaderUniqId = headers.output.items[0].glJournalHeaderUniqId
    expect(glJournalHeaderUniqId).toBe(' header%2Fkey ')
    const lines = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_gl_journal_lines',
      { ...AUTH, glJournalBatchId: '42', glJournalHeaderUniqId }
    )
    const glJournalLineUniqId = lines.output.items[0].glJournalLineUniqId
    expect(glJournalLineUniqId).toBe(' line key ')
    const detail = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_get_gl_journal_line',
      { ...AUTH, glJournalBatchId: '42', glJournalHeaderUniqId, glJournalLineUniqId }
    )
    expect(detail.output.glJournalLine).toEqual({
      glJournalLineUniqId: ' line key ',
      JeLineNumber: '10',
    })
    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
  })

  it('forwards balance finders without converting strings or estimating pagination termination', async () => {
    const finder =
      'AccountBalanceFinder;ledgerName=US Primary,accountCombination=01-120-5000,accountingPeriod=Sep-26'
    const balances = {
      ActualBalance: '#MISSING',
      BeginningBalance: null,
      EndingBalance: 'N/A',
      PeriodActivity: '120.00',
    }
    mockSecureFetch.mockResolvedValueOnce(
      response(200, { ...page([balances]), hasMore: true, totalResults: 0 })
    )
    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_gl_balances',
      { ...AUTH, finder, totalResults: true }
    )
    expect(result.output).toEqual({
      items: [balances],
      count: 1,
      hasMore: true,
      limit: 50,
      offset: 0,
      totalResults: 0,
    })
    expect(new URL(mockSecureFetch.mock.calls[0][0]).searchParams.get('finder')).toBe(finder)
    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
  })

  it('accepts an empty successful journal-batch deletion response', async () => {
    mockSecureFetch.mockResolvedValueOnce(response(204, ''))
    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_delete_gl_journal_batch',
      { ...AUTH, glJournalBatchId: '9007199254740993' }
    )
    expect(result).toEqual({
      success: true,
      output: { deleted: true, id: '9007199254740993' },
    })
    expect(mockSecureFetch.mock.calls[0][2]).toMatchObject({ method: 'DELETE' })
  })

  it('creates typed nested invoice lines and keeps the response projection fixed', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(
        201,
        item(`${RESOURCE_PATH}/receivablesInvoices/9007199254740993`, {
          CustomerTransactionId: '9007199254740993',
          TransactionNumber: 'AR-1',
        })
      )
    )
    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_create_receivables_invoice',
      {
        ...AUTH,
        businessUnit: 'Vision Operations',
        invoiceCurrencyCode: 'USD',
        lines: [{ LineNumber: 1, Description: 'Consulting', Quantity: 2, UnitSellingPrice: 50 }],
        distributions: [{ AccountClass: 'REC', Amount: 100, AccountCombination: '01-1200' }],
        arbitraryBody: { private: 'must-not-be-sent' },
      }
    )
    const [url, , options] = mockSecureFetch.mock.calls[0]
    expect(new URL(url).pathname).toBe(`${RESOURCE_PATH}/receivablesInvoices`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      BusinessUnit: 'Vision Operations',
      InvoiceCurrencyCode: 'USD',
      receivablesInvoiceLines: [
        { LineNumber: 1, Description: 'Consulting', Quantity: 2, UnitSellingPrice: 50 },
      ],
      receivablesInvoiceDistributions: [
        { AccountClass: 'REC', Amount: 100, AccountCombination: '01-1200' },
      ],
    })
    expect(result.output).toEqual({
      receivablesInvoice: { CustomerTransactionId: '9007199254740993', TransactionNumber: 'AR-1' },
    })
  })

  it('restricts invoice and installment updates to their documented writable fields', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(
        response(
          200,
          item(`${RESOURCE_PATH}/receivablesInvoices/42`, { CustomerTransactionId: '42' })
        )
      )
      .mockResolvedValueOnce(
        response(
          200,
          item(`${RESOURCE_PATH}/receivablesInvoices/42/child/receivablesInvoiceInstallments/7`, {
            InstallmentId: '7',
            OriginalAmount: 100,
          })
        )
      )
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_update_receivables_invoice',
      { ...AUTH, receivablesInvoiceId: '42', paymentTerms: 'Net 30', businessUnit: 'Unrelated' }
    )
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_update_receivables_invoice_installment',
      {
        ...AUTH,
        receivablesInvoiceId: '42',
        receivablesInvoiceInstallmentId: '7',
        originalAmount: 100,
        excludeFromCollections: true,
      }
    )
    expect(JSON.parse(mockSecureFetch.mock.calls[0][2].body)).toEqual({ PaymentTerms: 'Net 30' })
    expect(JSON.parse(mockSecureFetch.mock.calls[1][2].body)).toEqual({ OriginalAmount: 100 })
  })

  it('carries an exact installment identifier from invoice reads into receipt application', async () => {
    const installmentId = '9007199254740993'
    mockSecureFetch
      .mockResolvedValueOnce(
        response(
          200,
          page([
            item(`${RESOURCE_PATH}/receivablesInvoices/42`, {
              CustomerTransactionId: '42',
              TransactionNumber: 'AR-42',
            }),
          ])
        )
      )
      .mockResolvedValueOnce(
        response(
          200,
          page([
            item(
              `${RESOURCE_PATH}/receivablesInvoices/42/child/receivablesInvoiceInstallments/${installmentId}`,
              { InstallmentId: installmentId, BalanceDue: 12.5 }
            ),
          ])
        )
      )
      .mockResolvedValueOnce(response(200, { result: 'SUCCESS' }))
    const invoices = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_receivables_invoices',
      AUTH
    )
    const invoiceId = invoices.output.items[0].CustomerTransactionId
    const installments = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_receivables_invoice_installments',
      { ...AUTH, receivablesInvoiceId: invoiceId }
    )
    const selectedId = installments.output.items[0].InstallmentId
    const applied = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_apply_receivables_receipt',
      {
        ...AUTH,
        receivablesReceiptId: '88',
        appliedPaymentScheduleId: selectedId,
        amountApplied: 12.5,
      }
    )
    const [url, , options] = mockSecureFetch.mock.calls[2]
    expect(new URL(url).pathname).toBe(`${RESOURCE_PATH}/standardReceipts/88/action/applyReceipt`)
    expect(options.body).toBe('{"appliedPaymentScheduleId":9007199254740993,"amountApplied":12.5}')
    expect(new Headers(options.headers).get('Content-Type')).toBe(
      'application/vnd.oracle.adf.action+json'
    )
    expect(applied).toEqual({ success: true, output: { result: 'SUCCESS' } })
    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['oracle_fusion_financials_approve_receivables_invoice', { receivablesInvoiceId: '42' }],
    ['oracle_fusion_financials_rework_receivables_invoice', { receivablesInvoiceId: '42' }],
    ['oracle_fusion_financials_approve_receivables_credit_memo', { receivablesCreditMemoId: '42' }],
    ['oracle_fusion_financials_rework_receivables_credit_memo', { receivablesCreditMemoId: '42' }],
    [
      'oracle_fusion_financials_apply_receivables_receipt',
      { receivablesReceiptId: '42', appliedPaymentScheduleId: '9007199254740993' },
    ],
  ] as const)(
    'does not mistake an unsuccessful %s result for business success',
    async (toolId, input) => {
      mockSecureFetch.mockResolvedValueOnce(
        response(200, { result: 'ERROR', internal: AUTH.accessToken })
      )
      const result = await executeOracleFusionFinancialsOperation(toolId, { ...AUTH, ...input })
      expect(result).toEqual({
        success: false,
        output: { result: 'ERROR' },
        error: 'Oracle Fusion action reported an unsuccessful result',
      })
      expect(mockSecureFetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['oracle_fusion_financials_delete_receivables_invoice', { receivablesInvoiceId: '42' }],
    ['oracle_fusion_financials_delete_receivables_receipt', { receivablesReceiptId: '42' }],
  ] as const)('accepts successful no-content deletion for %s', async (toolId, input) => {
    mockSecureFetch.mockResolvedValueOnce(response(204, ''))
    const result = await executeOracleFusionFinancialsOperation(toolId, { ...AUTH, ...input })
    expect(result).toEqual({ success: true, output: { deleted: true, id: '42' } })
    expect(mockSecureFetch.mock.calls[0][2].method).toBe('DELETE')
    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
  })

  it('creates an expense report with exact IDs and follows its opaque key to create a line', async () => {
    const id = '9007199254740993'
    const reportKey = ' report%2Fkey '
    const reportPath = `${RESOURCE_PATH}/expenseReports/%20report%252Fkey%20`
    const linePath = `${reportPath}/child/Expense/LINEKEY`
    mockSecureFetch
      .mockResolvedValueOnce(
        response(201, {
          ExpenseReportId: id,
          Purpose: 'Business travel',
          '@context': { links: selfLink(reportPath) },
        })
      )
      .mockResolvedValueOnce(
        response(201, {
          ExpenseId: '42',
          ExpenseReportId: id,
          ItemizationParentExpenseId: -1,
          '@context': { links: selfLink(linePath) },
        })
      )
    const created = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_create_expense_report',
      { ...AUTH, orgId: id, personId: id, purpose: 'Business travel' }
    )
    expect(created.output.expenseReport.expenseReportUniqId).toBe(reportKey)
    expect(mockSecureFetch.mock.calls[0][2].body).toBe(
      '{"OrgId":9007199254740993,"PersonId":9007199254740993,"Purpose":"Business travel"}'
    )
    const line = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_create_expense_line',
      {
        ...AUTH,
        expenseReportUniqId: created.output.expenseReport.expenseReportUniqId,
        assignmentId: id,
        orgId: id,
        personId: id,
        ticketClass: 'Economy',
        itemizationParentExpenseId: '-1',
      }
    )
    expect(new URL(mockSecureFetch.mock.calls[1][0]).pathname).toBe(`${reportPath}/child/Expense`)
    expect(mockSecureFetch.mock.calls[1][2].body).toContain('"ItemizationParentExpenseId":-1')
    expect(line.output).toEqual({
      expenseLine: {
        expenseLineUniqId: 'LINEKEY',
        ExpenseId: '42',
        ExpenseReportId: id,
        ItemizationParentExpenseId: '-1',
      },
    })
  })

  it.each([
    ['oracle_fusion_financials_submit_expense_report', {}, 'S', true],
    ['oracle_fusion_financials_submit_expense_report', {}, '1:EXP-42', false],
    [
      'oracle_fusion_financials_remove_expense_report_cash_advance',
      { cashAdvanceNumber: 'CA-1' },
      'Y',
      true,
    ],
    [
      'oracle_fusion_financials_remove_expense_report_cash_advance',
      { cashAdvanceNumber: 'CA-1' },
      'N',
      false,
    ],
  ] as const)(
    'interprets the documented result of %s as %s',
    async (toolId, fields, result, success) => {
      mockSecureFetch.mockResolvedValueOnce(response(200, { result }))
      const output = await executeOracleFusionFinancialsOperation(toolId, {
        ...AUTH,
        expenseReportUniqId: 'REPORTKEY',
        ...fields,
      })
      expect(output.success).toBe(success)
      expect(output.output).toEqual({ result })
      expect(mockSecureFetch).toHaveBeenCalledTimes(1)
      expect(JSON.parse(mockSecureFetch.mock.calls[0][2].body)).toEqual(fields)
    }
  )

  it('updates expense distributions with their required numeric body identities', async () => {
    const path = `${RESOURCE_PATH}/expenseReports/REPORTKEY/child/Expense/LINEKEY/child/ExpenseDistribution/42`
    mockSecureFetch.mockResolvedValueOnce(
      response(
        200,
        item(path, {
          ExpenseDistId: '42',
          ExpenseId: '9007199254740993',
          OrgId: '9007199254740994',
          CostCenter: '120',
        })
      )
    )
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_update_expense_distribution',
      {
        ...AUTH,
        expenseReportUniqId: 'REPORTKEY',
        expenseLineUniqId: 'LINEKEY',
        expenseDistributionId: '42',
        expenseId: '9007199254740993',
        orgId: '9007199254740994',
        costCenter: '120',
      }
    )
    expect(new URL(mockSecureFetch.mock.calls[0][0]).pathname).toBe(path)
    expect(mockSecureFetch.mock.calls[0][2].body).toBe(
      '{"ExpenseId":9007199254740993,"OrgId":9007199254740994,"CostCenter":"120"}'
    )
  })

  it.each(OPERATION_CASES)(
    'executes $name with its exact path, fixed projection, and semantic output',
    async (operation) => {
      const isList = operation.wrapper === undefined
      mockSecureFetch.mockResolvedValueOnce(
        response(
          200,
          isList
            ? {
                ...page([operation.item], { limit: 25, offset: 5, totalResults: 100 }),
                hasMore: true,
              }
            : operation.item
        )
      )

      const result = await executeOracleFusionFinancialsOperation(operation.toolId, {
        ...AUTH,
        ...operation.input,
        ...(isList
          ? {
              q: 'Status!=Closed',
              finder: 'PrimaryKey;Id=1',
              orderBy: 'CreationDate:desc',
              limit: 25,
              offset: 5,
              totalResults: true,
            }
          : {}),
        ...(operation.toolId === 'oracle_fusion_financials_list_payables_invoices'
          ? { effectiveDate: '2026-09-02' }
          : {}),
        fields: 'attachments,invoiceDff',
        expand: 'all',
        dependency: 'anything',
        onlyData: true,
      })

      const [requestUrl] = mockSecureFetch.mock.calls[0]
      const url = new URL(requestUrl)
      expect(url.pathname).toBe(operation.path)
      expect(url.searchParams.get('fields')).toBe(operation.fields.join(','))
      expect(url.searchParams.get('links')).toBe('self')
      expect(url.searchParams.has('expand')).toBe(false)
      expect(url.searchParams.has('dependency')).toBe(false)
      expect(url.searchParams.has('onlyData')).toBe(false)
      expect(mockSecureFetch).toHaveBeenCalledTimes(1)

      const output = result.output as Record<string, unknown>
      const projected = isList
        ? ((output.items as Array<Record<string, unknown>>)[0] ?? {})
        : (output[operation.wrapper as string] as Record<string, unknown>)
      expect(projected.UnexpectedFlexfield).toBeUndefined()
      expect(projected.links).toBeUndefined()
      expect(projected['@context']).toBeUndefined()
      expect(output.nextOffset).toBeUndefined()
      if (operation.derivedKey) {
        expect(projected[operation.derivedKey.name]).toBe(operation.derivedKey.value)
      }
      if (isList) {
        expect(url.searchParams.get('q')).toBe('Status!=Closed')
        expect(url.searchParams.get('finder')).toBe('PrimaryKey;Id=1')
        expect(url.searchParams.get('orderBy')).toBe('CreationDate:desc')
        expect(url.searchParams.get('limit')).toBe('25')
        expect(url.searchParams.get('offset')).toBe('5')
        expect(url.searchParams.get('totalResults')).toBe('true')
        expect(output).toMatchObject({
          count: 1,
          hasMore: true,
          limit: 25,
          offset: 5,
          totalResults: 100,
        })
      } else {
        expect(url.searchParams.has('limit')).toBe(false)
        expect(Object.keys(output)).toEqual([operation.wrapper])
      }
    }
  )

  it('defaults lists to one page of 50 and forwards invoice effectiveDate', async () => {
    mockSecureFetch.mockResolvedValueOnce(response(200, page([])))
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoices',
      { ...AUTH, effectiveDate: '2026-09-02' }
    )
    const url = new URL(mockSecureFetch.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      effectiveDate: '2026-09-02',
      limit: '50',
      offset: '0',
    })
    expect(url.searchParams.has('totalResults')).toBe(false)
  })

  it('round-trips v9 invoice line keys while preserving exact numbers and fixed projections', async () => {
    const providerLine = {
      LineNumber: '9007199254740993',
      ReceiptLineNumber: '999999999999999999',
      LineAmount: 12.5,
      '@context': { links: selfLink(LINE_PATH) },
      UnexpectedFlexfield: 'must not escape',
    }
    mockSecureFetch
      .mockResolvedValueOnce(response(200, page([providerLine])))
      .mockResolvedValueOnce(response(200, providerLine))

    const listed = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoice_lines',
      { ...AUTH, invoiceUniqId: 'INVOICEKEY' }
    )
    const expectedLine = {
      invoiceLineUniqId: 'LINEKEY',
      LineNumber: '9007199254740993',
      ReceiptLineNumber: '999999999999999999',
      LineAmount: 12.5,
    }
    expect(listed.output).toMatchObject({ items: [expectedLine] })
    const detail = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_get_payables_invoice_line',
      { ...AUTH, invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: expectedLine.invoiceLineUniqId }
    )
    expect(detail.output).toEqual({ invoiceLine: expectedLine })
    expect(new URL(mockSecureFetch.mock.calls[1][0]).pathname).toBe(LINE_PATH)
    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
  })

  it('encodes every opaque parent key in nested resource paths', async () => {
    const invoiceUniqId = 'INVOICE key+1'
    const invoiceLineUniqId = 'LINE key+2'
    const collectionPath = `${RESOURCE_PATH}/invoices/INVOICE%20key%2B1/child/invoiceLines/LINE%20key%2B2/child/invoiceDistributions`
    mockSecureFetch.mockResolvedValueOnce(
      response(200, page([item(`${collectionPath}/99`, { InvoiceDistributionId: 99 })]))
    )

    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoice_distributions',
      { ...AUTH, invoiceUniqId, invoiceLineUniqId }
    )

    expect(new URL(mockSecureFetch.mock.calls[0][0]).pathname).toBe(collectionPath)
  })

  it.each([
    [{ limit: 101 }, 'limit'],
    [{ limit: 0 }, 'limit'],
    [{ offset: -1 }, 'offset'],
    [{ offset: 1.5 }, 'offset'],
    [{ effectiveDate: '2026-02-30' }, 'effectiveDate'],
  ])('rejects invalid list controls %# before outbound I/O (%s)', async (fields) => {
    await expect(
      executeOracleFusionFinancialsOperation('oracle_fusion_financials_list_payables_invoices', {
        ...AUTH,
        ...fields,
      })
    ).rejects.toBeDefined()
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['oracle_fusion_financials_get_payables_payment', 'checkId', { checkId: '42' }],
    [
      'oracle_fusion_financials_get_payables_invoice_distribution',
      'invoiceDistributionId',
      { invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY', invoiceDistributionId: '99' },
    ],
    [
      'oracle_fusion_financials_get_payables_payment_related_invoice',
      'invoicePaymentId',
      { checkId: '42', invoicePaymentId: '88' },
    ],
    ['oracle_fusion_financials_get_payables_invoice_hold', 'holdId', { holdId: '21' }],
    [
      'oracle_fusion_financials_get_payment_process_request',
      'paymentProcessRequestId',
      { paymentProcessRequestId: '17' },
    ],
    ['oracle_fusion_financials_get_payables_payment_term', 'termsId', { termsId: '73' }],
  ] as const)(
    'rejects invalid decimal path values for %s.%s',
    async (toolId, field, validInput) => {
      for (const invalid of ['-1', '1.5', 'abc', '1/child']) {
        await expect(
          executeOracleFusionFinancialsOperation(toolId, {
            ...AUTH,
            ...validInput,
            [field]: invalid,
          })
        ).rejects.toBeDefined()
      }
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects missing, duplicate, malformed, cross-origin, wrong-parent, and escaped opaque links', async () => {
    const badLinks = [
      [],
      [
        { rel: 'self', href: `${ORIGIN}${LINE_PATH}` },
        { rel: 'self', href: `${ORIGIN}${LINE_PATH}` },
      ],
      [{ rel: 'self', href: 'not a URL' }],
      [{ rel: 'self', href: `https://attacker.example${LINE_PATH}` }],
      [{ rel: 'self', href: `${ORIGIN}${INSTALLMENT_PATH}` }],
      [{ rel: 'self', href: `${ORIGIN}${LINE_COLLECTION_PATH}/A%2FB` }],
    ]

    for (const links of badLinks) {
      mockSecureFetch.mockResolvedValueOnce(response(200, page([{ LineNumber: 1, links }])))
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_list_payables_invoice_lines',
          { ...AUTH, invoiceUniqId: 'INVOICEKEY' }
        )
      ).rejects.toMatchObject({ status: 502 })
    }
  })

  it('rejects detail self links with a different key, parent, origin, query, or fragment', async () => {
    const badPaths = [
      `${LINE_COLLECTION_PATH}/DIFFERENT`,
      `${RESOURCE_PATH}/invoices/OTHER/child/invoiceLines/LINEKEY`,
      `${LINE_PATH}?fields=all`,
      `${LINE_PATH}#fragment`,
    ]
    const hrefs = [
      ...badPaths.map((path) => `${ORIGIN}${path}`),
      `https://attacker.example${LINE_PATH}`,
    ]

    for (const href of hrefs) {
      mockSecureFetch.mockResolvedValueOnce(
        response(200, { LineNumber: 1, links: [{ rel: 'self', href }] })
      )
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_get_payables_invoice_line',
          { ...AUTH, invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY' }
        )
      ).rejects.toMatchObject({ status: 502 })
    }
  })

  it('rejects malformed list envelopes and projected field types', async () => {
    const invalidPayloads = [
      { items: [], count: '0', hasMore: false, limit: 50, offset: 0 },
      { items: [], count: 1, hasMore: false, limit: 50, offset: 0 },
      { count: 1, hasMore: false, limit: 50, offset: 0 },
      page([{ CheckId: 'not-a-number' }]),
    ]
    for (const payload of invalidPayloads) {
      mockSecureFetch.mockResolvedValueOnce(response(200, payload))
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_list_payables_payments',
          AUTH
        )
      ).rejects.toMatchObject({
        name: 'OracleFusionProviderError',
        status: 502,
        message: 'Oracle Fusion Financials returned an unexpected response shape',
      })
    }
  })

  it('normalizes a documented empty collection without items to an empty page', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(200, { count: 0, hasMore: false, limit: 50, offset: 0 })
    )

    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_payments',
      AUTH
    )

    expect(result.output).toEqual({
      items: [],
      count: 0,
      hasMore: false,
      limit: 50,
      offset: 0,
    })
  })

  it.each(OPERATION_CASES.filter((operation) => operation.input))(
    'requires every parent and resource identifier for $name before fetching',
    async (operation) => {
      for (const key of Object.keys(operation.input ?? {})) {
        await expect(
          executeOracleFusionFinancialsOperation(operation.toolId, {
            ...AUTH,
            ...operation.input,
            [key]: undefined,
          })
        ).rejects.toMatchObject({ name: 'ZodError' })
      }
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )
})
