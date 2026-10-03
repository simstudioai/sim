import { filterUndefined } from '@sim/utils/object'
import type { z } from 'zod'
import {
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
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
  oracleFusionAppliedPrepaymentSchema,
  oracleFusionApplyReceivablesReceiptInputSchema,
  oracleFusionApproveReceivablesCreditMemoInputSchema,
  oracleFusionApproveReceivablesInvoiceInputSchema,
  oracleFusionAvailablePrepaymentSchema,
  oracleFusionCreateExpenseDistributionInputSchema,
  oracleFusionCreateExpenseItemizationInputSchema,
  oracleFusionCreateExpenseLineInputSchema,
  oracleFusionCreateExpenseReportInputSchema,
  oracleFusionCreateReceivablesCreditMemoDistributionInputSchema,
  oracleFusionCreateReceivablesCreditMemoInputSchema,
  oracleFusionCreateReceivablesCreditMemoLineInputSchema,
  oracleFusionCreateReceivablesInvoiceDistributionInputSchema,
  oracleFusionCreateReceivablesInvoiceInputSchema,
  oracleFusionCreateReceivablesInvoiceLineInputSchema,
  oracleFusionCreateReceivablesReceiptInputSchema,
  oracleFusionDeleteGlJournalBatchInputSchema,
  oracleFusionDeleteReceivablesInvoiceInputSchema,
  oracleFusionDeleteReceivablesReceiptInputSchema,
  oracleFusionExpenseDistributionSchema,
  oracleFusionExpenseItemizationSchema,
  oracleFusionExpenseLineErrorSchema,
  oracleFusionExpenseLineSchema,
  oracleFusionExpenseReportPaymentSchema,
  oracleFusionExpenseReportProcessingDetailSchema,
  oracleFusionExpenseReportSchema,
  oracleFusionFinancialsActionResultSchema,
  oracleFusionGetAppliedPrepaymentInputSchema,
  oracleFusionGetAvailablePrepaymentInputSchema,
  oracleFusionGetExpenseDistributionInputSchema,
  oracleFusionGetExpenseItemizationInputSchema,
  oracleFusionGetExpenseLineErrorInputSchema,
  oracleFusionGetExpenseLineInputSchema,
  oracleFusionGetExpenseReportInputSchema,
  oracleFusionGetExpenseReportPaymentInputSchema,
  oracleFusionGetExpenseReportProcessingDetailInputSchema,
  oracleFusionGetGlJournalActionLogInputSchema,
  oracleFusionGetGlJournalBatchInputSchema,
  oracleFusionGetGlJournalErrorInputSchema,
  oracleFusionGetGlJournalHeaderInputSchema,
  oracleFusionGetGlJournalLineInputSchema,
  oracleFusionGetGlLedgerInputSchema,
  oracleFusionGetInvoiceDistributionInputSchema,
  oracleFusionGetInvoiceHoldInputSchema,
  oracleFusionGetInvoiceInputSchema,
  oracleFusionGetInvoiceInstallmentInputSchema,
  oracleFusionGetInvoiceLineInputSchema,
  oracleFusionGetPaymentInputSchema,
  oracleFusionGetPaymentProcessRequestInputSchema,
  oracleFusionGetPaymentRelatedInvoiceInputSchema,
  oracleFusionGetPaymentTermInputSchema,
  oracleFusionGetPaymentTermLineInputSchema,
  oracleFusionGetReceivablesCreditMemoApplicationInputSchema,
  oracleFusionGetReceivablesCreditMemoDistributionInputSchema,
  oracleFusionGetReceivablesCreditMemoInputSchema,
  oracleFusionGetReceivablesCreditMemoLineInputSchema,
  oracleFusionGetReceivablesCustomerAccountInputSchema,
  oracleFusionGetReceivablesCustomerAccountSiteInputSchema,
  oracleFusionGetReceivablesInvoiceDistributionInputSchema,
  oracleFusionGetReceivablesInvoiceInputSchema,
  oracleFusionGetReceivablesInvoiceInstallmentInputSchema,
  oracleFusionGetReceivablesInvoiceLineInputSchema,
  oracleFusionGetReceivablesReceiptApplicationInputSchema,
  oracleFusionGetReceivablesReceiptInputSchema,
  oracleFusionGetReceivablesTransactionAdjustmentInputSchema,
  oracleFusionGetReceivablesTransactionPaymentScheduleInputSchema,
  oracleFusionGlBalanceSchema,
  oracleFusionGlJournalActionLogSchema,
  oracleFusionGlJournalBatchSchema,
  oracleFusionGlJournalErrorSchema,
  oracleFusionGlJournalHeaderSchema,
  oracleFusionGlJournalLineSchema,
  oracleFusionGlLedgerSchema,
  oracleFusionInstallmentSchema,
  oracleFusionInvoiceChildListInputSchema,
  oracleFusionInvoiceDistributionListInputSchema,
  oracleFusionInvoiceDistributionSchema,
  oracleFusionInvoiceHoldSchema,
  oracleFusionInvoiceLineSchema,
  oracleFusionInvoiceSchema,
  oracleFusionListExpenseDistributionsInputSchema,
  oracleFusionListExpenseItemizationsInputSchema,
  oracleFusionListExpenseLineErrorsInputSchema,
  oracleFusionListExpenseLinesInputSchema,
  oracleFusionListExpenseReportPaymentsInputSchema,
  oracleFusionListExpenseReportProcessingDetailsInputSchema,
  oracleFusionListExpenseReportsInputSchema,
  oracleFusionListGlBalancesInputSchema,
  oracleFusionListGlJournalActionLogsInputSchema,
  oracleFusionListGlJournalBatchesInputSchema,
  oracleFusionListGlJournalErrorsInputSchema,
  oracleFusionListGlJournalHeadersInputSchema,
  oracleFusionListGlJournalLinesInputSchema,
  oracleFusionListGlLedgersInputSchema,
  oracleFusionListInputSchema,
  oracleFusionListInvoicesInputSchema,
  oracleFusionListReceivablesCreditMemoApplicationsInputSchema,
  oracleFusionListReceivablesCreditMemoDistributionsInputSchema,
  oracleFusionListReceivablesCreditMemoLinesInputSchema,
  oracleFusionListReceivablesCreditMemosInputSchema,
  oracleFusionListReceivablesCustomerAccountSitesInputSchema,
  oracleFusionListReceivablesCustomerAccountsInputSchema,
  oracleFusionListReceivablesInvoiceDistributionsInputSchema,
  oracleFusionListReceivablesInvoiceInstallmentsInputSchema,
  oracleFusionListReceivablesInvoiceLinesInputSchema,
  oracleFusionListReceivablesInvoicesInputSchema,
  oracleFusionListReceivablesReceiptApplicationsInputSchema,
  oracleFusionListReceivablesReceiptsInputSchema,
  oracleFusionListReceivablesTransactionAdjustmentsInputSchema,
  oracleFusionListReceivablesTransactionPaymentSchedulesInputSchema,
  oracleFusionPaymentProcessRequestSchema,
  oracleFusionPaymentRelatedInvoiceListInputSchema,
  oracleFusionPaymentRelatedInvoiceSchema,
  oracleFusionPaymentSchema,
  oracleFusionPaymentTermLineListInputSchema,
  oracleFusionPaymentTermLineSchema,
  oracleFusionPaymentTermSchema,
  oracleFusionReceivablesCreditMemoApplicationSchema,
  oracleFusionReceivablesCreditMemoDistributionSchema,
  oracleFusionReceivablesCreditMemoLineSchema,
  oracleFusionReceivablesCreditMemoSchema,
  oracleFusionReceivablesCustomerAccountSchema,
  oracleFusionReceivablesCustomerAccountSiteSchema,
  oracleFusionReceivablesInvoiceDistributionSchema,
  oracleFusionReceivablesInvoiceInstallmentSchema,
  oracleFusionReceivablesInvoiceLineSchema,
  oracleFusionReceivablesInvoiceSchema,
  oracleFusionReceivablesReceiptApplicationSchema,
  oracleFusionReceivablesReceiptSchema,
  oracleFusionReceivablesTransactionAdjustmentSchema,
  oracleFusionReceivablesTransactionPaymentScheduleSchema,
  oracleFusionRemoveExpenseReportCashAdvanceInputSchema,
  oracleFusionReworkReceivablesCreditMemoInputSchema,
  oracleFusionReworkReceivablesInvoiceInputSchema,
  oracleFusionSubmitExpenseReportInputSchema,
  oracleFusionUpdateExpenseDistributionInputSchema,
  oracleFusionUpdateExpenseItemizationInputSchema,
  oracleFusionUpdateExpenseLineInputSchema,
  oracleFusionUpdateExpenseReportInputSchema,
  oracleFusionUpdateReceivablesCreditMemoInputSchema,
  oracleFusionUpdateReceivablesInvoiceInputSchema,
  oracleFusionUpdateReceivablesInvoiceInstallmentInputSchema,
  oracleFusionUpdateReceivablesReceiptInputSchema,
  projectFields,
} from '@/lib/internal/oracle-fusion-financials/schema'
import type { OracleFusionFinancialsListResponse } from '@/tools/oracle_fusion_financials/types'
import type { ToolResponse } from '@/tools/types'

export const ORACLE_FUSION_FINANCIALS_TOOL_IDS = [
  'oracle_fusion_financials_list_gl_ledgers',
  'oracle_fusion_financials_get_gl_ledger',
  'oracle_fusion_financials_list_gl_journal_batches',
  'oracle_fusion_financials_get_gl_journal_batch',
  'oracle_fusion_financials_delete_gl_journal_batch',
  'oracle_fusion_financials_list_gl_journal_headers',
  'oracle_fusion_financials_get_gl_journal_header',
  'oracle_fusion_financials_list_gl_journal_lines',
  'oracle_fusion_financials_get_gl_journal_line',
  'oracle_fusion_financials_list_gl_journal_errors',
  'oracle_fusion_financials_get_gl_journal_error',
  'oracle_fusion_financials_list_gl_journal_action_logs',
  'oracle_fusion_financials_get_gl_journal_action_log',
  'oracle_fusion_financials_list_gl_balances',
  'oracle_fusion_financials_list_expense_reports',
  'oracle_fusion_financials_get_expense_report',
  'oracle_fusion_financials_create_expense_report',
  'oracle_fusion_financials_update_expense_report',
  'oracle_fusion_financials_submit_expense_report',
  'oracle_fusion_financials_remove_expense_report_cash_advance',
  'oracle_fusion_financials_list_expense_lines',
  'oracle_fusion_financials_get_expense_line',
  'oracle_fusion_financials_create_expense_line',
  'oracle_fusion_financials_update_expense_line',
  'oracle_fusion_financials_list_expense_distributions',
  'oracle_fusion_financials_get_expense_distribution',
  'oracle_fusion_financials_create_expense_distribution',
  'oracle_fusion_financials_update_expense_distribution',
  'oracle_fusion_financials_list_expense_itemizations',
  'oracle_fusion_financials_get_expense_itemization',
  'oracle_fusion_financials_create_expense_itemization',
  'oracle_fusion_financials_update_expense_itemization',
  'oracle_fusion_financials_list_expense_report_processing_details',
  'oracle_fusion_financials_get_expense_report_processing_detail',
  'oracle_fusion_financials_list_expense_report_payments',
  'oracle_fusion_financials_get_expense_report_payment',
  'oracle_fusion_financials_list_expense_line_errors',
  'oracle_fusion_financials_get_expense_line_error',
  'oracle_fusion_financials_list_receivables_invoices',
  'oracle_fusion_financials_get_receivables_invoice',
  'oracle_fusion_financials_create_receivables_invoice',
  'oracle_fusion_financials_update_receivables_invoice',
  'oracle_fusion_financials_delete_receivables_invoice',
  'oracle_fusion_financials_approve_receivables_invoice',
  'oracle_fusion_financials_rework_receivables_invoice',
  'oracle_fusion_financials_list_receivables_invoice_lines',
  'oracle_fusion_financials_get_receivables_invoice_line',
  'oracle_fusion_financials_create_receivables_invoice_line',
  'oracle_fusion_financials_list_receivables_invoice_distributions',
  'oracle_fusion_financials_get_receivables_invoice_distribution',
  'oracle_fusion_financials_create_receivables_invoice_distribution',
  'oracle_fusion_financials_list_receivables_invoice_installments',
  'oracle_fusion_financials_get_receivables_invoice_installment',
  'oracle_fusion_financials_update_receivables_invoice_installment',
  'oracle_fusion_financials_list_receivables_credit_memos',
  'oracle_fusion_financials_get_receivables_credit_memo',
  'oracle_fusion_financials_create_receivables_credit_memo',
  'oracle_fusion_financials_update_receivables_credit_memo',
  'oracle_fusion_financials_approve_receivables_credit_memo',
  'oracle_fusion_financials_rework_receivables_credit_memo',
  'oracle_fusion_financials_list_receivables_credit_memo_lines',
  'oracle_fusion_financials_get_receivables_credit_memo_line',
  'oracle_fusion_financials_create_receivables_credit_memo_line',
  'oracle_fusion_financials_list_receivables_credit_memo_distributions',
  'oracle_fusion_financials_get_receivables_credit_memo_distribution',
  'oracle_fusion_financials_create_receivables_credit_memo_distribution',
  'oracle_fusion_financials_list_receivables_receipts',
  'oracle_fusion_financials_get_receivables_receipt',
  'oracle_fusion_financials_create_receivables_receipt',
  'oracle_fusion_financials_update_receivables_receipt',
  'oracle_fusion_financials_delete_receivables_receipt',
  'oracle_fusion_financials_apply_receivables_receipt',
  'oracle_fusion_financials_list_receivables_customer_accounts',
  'oracle_fusion_financials_get_receivables_customer_account',
  'oracle_fusion_financials_list_receivables_customer_account_sites',
  'oracle_fusion_financials_get_receivables_customer_account_site',
  'oracle_fusion_financials_list_receivables_receipt_applications',
  'oracle_fusion_financials_get_receivables_receipt_application',
  'oracle_fusion_financials_list_receivables_credit_memo_applications',
  'oracle_fusion_financials_get_receivables_credit_memo_application',
  'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
  'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
  'oracle_fusion_financials_list_receivables_transaction_adjustments',
  'oracle_fusion_financials_get_receivables_transaction_adjustment',
  'oracle_fusion_financials_list_payables_invoices',
  'oracle_fusion_financials_get_payables_invoice',
  'oracle_fusion_financials_list_payables_invoice_lines',
  'oracle_fusion_financials_get_payables_invoice_line',
  'oracle_fusion_financials_list_payables_invoice_installments',
  'oracle_fusion_financials_get_payables_invoice_installment',
  'oracle_fusion_financials_list_payables_invoice_distributions',
  'oracle_fusion_financials_get_payables_invoice_distribution',
  'oracle_fusion_financials_list_payables_applied_prepayments',
  'oracle_fusion_financials_get_payables_applied_prepayment',
  'oracle_fusion_financials_list_payables_available_prepayments',
  'oracle_fusion_financials_get_payables_available_prepayment',
  'oracle_fusion_financials_list_payables_payments',
  'oracle_fusion_financials_get_payables_payment',
  'oracle_fusion_financials_list_payables_payment_related_invoices',
  'oracle_fusion_financials_get_payables_payment_related_invoice',
  'oracle_fusion_financials_list_payment_process_requests',
  'oracle_fusion_financials_get_payment_process_request',
  'oracle_fusion_financials_list_payables_invoice_holds',
  'oracle_fusion_financials_get_payables_invoice_hold',
  'oracle_fusion_financials_list_payables_payment_terms',
  'oracle_fusion_financials_get_payables_payment_term',
  'oracle_fusion_financials_list_payables_payment_term_lines',
  'oracle_fusion_financials_get_payables_payment_term_line',
] as const

export type OracleFusionFinancialsToolId = (typeof ORACLE_FUSION_FINANCIALS_TOOL_IDS)[number]

const TOOL_ID_SET = new Set<string>(ORACLE_FUSION_FINANCIALS_TOOL_IDS)

export function isOracleFusionFinancialsToolId(
  value: string
): value is OracleFusionFinancialsToolId {
  return TOOL_ID_SET.has(value)
}

interface ListInput {
  q?: string
  finder?: string
  orderBy?: string
  limit: number
  offset: number
  totalResults: boolean
}

interface AuthInput {
  accessToken: string
  instanceUrl: string
}

function listQuery(
  input: ListInput,
  fields: readonly string[],
  extra?: Record<string, string | undefined>
): Record<string, string | number | boolean | undefined> {
  return {
    fields: fields.join(','),
    links: 'self',
    q: input.q,
    finder: input.finder,
    orderBy: input.orderBy,
    limit: input.limit,
    offset: input.offset,
    totalResults: input.totalResults || undefined,
    ...extra,
  }
}

function detailQuery(fields: readonly string[]): Record<string, string> {
  return { fields: fields.join(','), links: 'self' }
}

function requireProviderResponse<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    throw new OracleFusionProviderError(
      'Oracle Fusion Financials returned an unexpected response shape',
      502
    )
  }
}

function projectList<T extends z.ZodType<Record<string, unknown>>>(
  payload: unknown,
  itemSchema: T,
  fields: readonly string[],
  input: ListInput,
  transform?: (item: z.output<T>) => Record<string, unknown>
): OracleFusionFinancialsListResponse {
  return requireProviderResponse(() => {
    const envelope = parseOracleFusionCollection(
      payload,
      (item) => {
        const parsed = itemSchema.parse(item)
        return transform ? transform(parsed) : projectFields(parsed, fields)
      },
      { expectedOffset: input.offset, maxItems: input.limit }
    )
    return {
      success: true,
      output: {
        items: envelope.items,
        count: envelope.count,
        hasMore: envelope.hasMore,
        limit: envelope.limit,
        offset: envelope.offset,
        ...(envelope.totalResults !== undefined ? { totalResults: envelope.totalResults } : {}),
      },
    }
  })
}

async function executeList<T extends z.ZodType<Record<string, unknown>>>(
  input: AuthInput & ListInput,
  path: string,
  itemSchema: T,
  fields: readonly string[],
  signal?: AbortSignal,
  transform?: (item: z.output<T>) => Record<string, unknown>,
  extra?: Record<string, string | undefined>
): Promise<OracleFusionFinancialsListResponse> {
  const payload = await requestOracleFusionJson(
    input,
    { address: { family: 'fscm', relativePath: path }, query: listQuery(input, fields, extra) },
    signal
  )
  return projectList(payload, itemSchema, fields, input, transform)
}

async function executeDetail<T extends z.ZodType<Record<string, unknown>>>(
  input: AuthInput,
  path: string,
  itemSchema: T,
  fields: readonly string[],
  wrapper: string,
  signal?: AbortSignal,
  transform?: (item: z.output<T>) => Record<string, unknown>
): Promise<{ success: true; output: Record<string, Record<string, unknown>> }> {
  const rawPayload = await requestOracleFusionJson(
    input,
    { address: { family: 'fscm', relativePath: path }, query: detailQuery(fields) },
    signal
  )
  return requireProviderResponse(() => {
    const payload = itemSchema.parse(rawPayload)
    validateOracleFusionSelfLink(payload, input.instanceUrl, { family: 'fscm', relativePath: path })
    return {
      success: true,
      output: {
        [wrapper]: transform ? transform(payload) : projectFields(payload, fields),
      },
    }
  })
}

function invoicePath(invoiceUniqId: string): string {
  return `invoices/${encodeOracleFusionPathSegment(invoiceUniqId)}`
}

async function executeFinancialsWrite<T extends z.ZodType<Record<string, unknown>>>(
  input: AuthInput,
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  itemSchema: T,
  fields: readonly string[],
  wrapper: string,
  idField: string,
  signal?: AbortSignal,
  opaqueKeyField?: string
): Promise<ToolResponse> {
  const raw = await requestOracleFusionJson(
    input,
    {
      address: { family: 'fscm', relativePath: path },
      method,
      mediaType: 'application/json',
      body,
    },
    signal
  )
  return requireProviderResponse(() => {
    const item = itemSchema.parse(raw)
    const opaqueKey = opaqueKeyField
      ? extractOracleFusionOpaqueKey(item, input.instanceUrl, {
          family: 'fscm',
          relativePath: method === 'POST' ? path : path.slice(0, path.lastIndexOf('/')),
        })
      : undefined
    let expectedPath = path
    if (method === 'POST') {
      const id = opaqueKey ?? item[idField]
      if (typeof id !== 'string') throw new Error('Created resource has no exact identifier')
      expectedPath = `${path}/${encodeOracleFusionPathSegment(id)}`
    }
    validateOracleFusionSelfLink(item, input.instanceUrl, {
      family: 'fscm',
      relativePath: expectedPath,
    })
    return {
      success: true,
      output: {
        [wrapper]: {
          ...projectFields(item, fields),
          ...(opaqueKeyField ? { [opaqueKeyField]: opaqueKey } : {}),
        },
      },
    }
  })
}

async function executeFinancialsAction(
  input: AuthInput,
  path: string,
  body: Record<string, unknown>,
  expectedResult: string,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const raw = await requestOracleFusionJson(
    input,
    {
      address: { family: 'fscm', relativePath: path },
      method: 'POST',
      mediaType: 'application/vnd.oracle.adf.action+json',
      body,
    },
    signal
  )
  const output = requireProviderResponse(() => oracleFusionFinancialsActionResultSchema.parse(raw))
  return output.result === expectedResult
    ? { success: true, output }
    : { success: false, output, error: 'Oracle Fusion action reported an unsuccessful result' }
}

function invoiceLineCollectionPath(invoiceUniqId: string): string {
  return `${invoicePath(invoiceUniqId)}/child/invoiceLines`
}

function invoiceInstallmentCollectionPath(invoiceUniqId: string): string {
  return `${invoicePath(invoiceUniqId)}/child/invoiceInstallments`
}

function invoiceDistributionCollectionPath(
  invoiceUniqId: string,
  invoiceLineUniqId: string
): string {
  return `${invoiceLineCollectionPath(invoiceUniqId)}/${encodeOracleFusionPathSegment(invoiceLineUniqId)}/child/invoiceDistributions`
}

function prepaymentCollectionPath(
  invoiceUniqId: string,
  collection: 'appliedPrepayments' | 'availablePrepayments'
): string {
  return `${invoicePath(invoiceUniqId)}/child/${collection}`
}

function paymentPath(checkId: string): string {
  return `payablesPayments/${checkId}`
}

function relatedInvoiceCollectionPath(checkId: string): string {
  return `${paymentPath(checkId)}/child/relatedInvoices`
}

function paymentTermPath(termsId: string): string {
  return `payablesPaymentTerms/${termsId}`
}

function paymentTermLineCollectionPath(termsId: string): string {
  return `${paymentTermPath(termsId)}/child/payablesPaymentTermsLines`
}

export async function listOracleFusionInvoices(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionListInvoicesInputSchema.parse(rawInput)
  return executeList(
    input,
    'invoices',
    oracleFusionInvoiceSchema,
    ORACLE_FUSION_INVOICE_FIELDS,
    signal,
    (invoice) => ({
      invoiceUniqId: extractOracleFusionOpaqueKey(invoice, input.instanceUrl, {
        family: 'fscm',
        relativePath: 'invoices',
      }),
      ...projectFields(invoice, ORACLE_FUSION_INVOICE_FIELDS),
    }),
    { effectiveDate: input.effectiveDate }
  )
}

export async function getOracleFusionInvoice(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionGetInvoiceInputSchema.parse(rawInput)
  return executeDetail(
    input,
    invoicePath(input.invoiceUniqId),
    oracleFusionInvoiceSchema,
    ORACLE_FUSION_INVOICE_FIELDS,
    'invoice',
    signal,
    (invoice) => ({
      invoiceUniqId: extractOracleFusionOpaqueKey(invoice, input.instanceUrl, {
        family: 'fscm',
        relativePath: 'invoices',
      }),
      ...projectFields(invoice, ORACLE_FUSION_INVOICE_FIELDS),
    })
  )
}

export async function listOracleFusionReceivablesInvoices(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionListReceivablesInvoicesInputSchema.parse(rawInput)
  return executeList(
    input,
    'receivablesInvoices',
    oracleFusionReceivablesInvoiceSchema,
    ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
    signal,
    (item) => {
      const id = item.CustomerTransactionId
      if (typeof id !== 'string') throw new Error('Resource has no exact identifier')
      validateOracleFusionSelfLink(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: `receivablesInvoices/${encodeOracleFusionPathSegment(id)}`,
      })
      return projectFields(item, ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS)
    }
  )
}

export async function getOracleFusionReceivablesInvoice(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionGetReceivablesInvoiceInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}`,
    oracleFusionReceivablesInvoiceSchema,
    ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
    'receivablesInvoice',
    signal
  )
}

export async function listOracleFusionReceivablesCreditMemos(
  rawInput: unknown,
  signal?: AbortSignal
) {
  const input = oracleFusionListReceivablesCreditMemosInputSchema.parse(rawInput)
  return executeList(
    input,
    'receivablesCreditMemos',
    oracleFusionReceivablesCreditMemoSchema,
    ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
    signal,
    (item) => {
      const id = item.CustomerTransactionId
      if (typeof id !== 'string') throw new Error('Resource has no exact identifier')
      validateOracleFusionSelfLink(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: `receivablesCreditMemos/${encodeOracleFusionPathSegment(id)}`,
      })
      return projectFields(item, ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS)
    }
  )
}

export async function getOracleFusionReceivablesCreditMemo(
  rawInput: unknown,
  signal?: AbortSignal
) {
  const input = oracleFusionGetReceivablesCreditMemoInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}`,
    oracleFusionReceivablesCreditMemoSchema,
    ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
    'receivablesCreditMemo',
    signal
  )
}

export async function listOracleFusionReceivablesReceipts(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionListReceivablesReceiptsInputSchema.parse(rawInput)
  return executeList(
    input,
    'standardReceipts',
    oracleFusionReceivablesReceiptSchema,
    ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
    signal,
    (item) => {
      const id = item.StandardReceiptId
      if (typeof id !== 'string') throw new Error('Resource has no exact identifier')
      validateOracleFusionSelfLink(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: `standardReceipts/${encodeOracleFusionPathSegment(id)}`,
      })
      return projectFields(item, ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS)
    }
  )
}

export async function getOracleFusionReceivablesReceipt(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionGetReceivablesReceiptInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `standardReceipts/${encodeOracleFusionPathSegment(input.receivablesReceiptId)}`,
    oracleFusionReceivablesReceiptSchema,
    ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
    'receivablesReceipt',
    signal
  )
}

export async function listOracleFusionReceivablesCustomerAccounts(
  rawInput: unknown,
  signal?: AbortSignal
) {
  const input = oracleFusionListReceivablesCustomerAccountsInputSchema.parse(rawInput)
  return executeList(
    input,
    'receivablesCustomerAccountActivities',
    oracleFusionReceivablesCustomerAccountSchema,
    ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS,
    signal,
    (item) => {
      const id = item.AccountId
      if (typeof id !== 'string') throw new Error('Resource has no exact identifier')
      validateOracleFusionSelfLink(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(id)}`,
      })
      return projectFields(item, ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS)
    }
  )
}

export async function getOracleFusionReceivablesCustomerAccount(
  rawInput: unknown,
  signal?: AbortSignal
) {
  const input = oracleFusionGetReceivablesCustomerAccountInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}`,
    oracleFusionReceivablesCustomerAccountSchema,
    ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS,
    'receivablesCustomerAccount',
    signal
  )
}

export async function listOracleFusionReceivablesCustomerAccountSites(
  rawInput: unknown,
  signal?: AbortSignal
) {
  const input = oracleFusionListReceivablesCustomerAccountSitesInputSchema.parse(rawInput)
  return executeList(
    input,
    'receivablesCustomerAccountSiteActivities',
    oracleFusionReceivablesCustomerAccountSiteSchema,
    ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS,
    signal,
    (item) => {
      const id = item.BillToSiteUseId
      if (typeof id !== 'string') throw new Error('Resource has no exact identifier')
      validateOracleFusionSelfLink(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: `receivablesCustomerAccountSiteActivities/${encodeOracleFusionPathSegment(id)}`,
      })
      return projectFields(item, ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS)
    }
  )
}

export async function getOracleFusionReceivablesCustomerAccountSite(
  rawInput: unknown,
  signal?: AbortSignal
) {
  const input = oracleFusionGetReceivablesCustomerAccountSiteInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `receivablesCustomerAccountSiteActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountSiteId)}`,
    oracleFusionReceivablesCustomerAccountSiteSchema,
    ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS,
    'receivablesCustomerAccountSite',
    signal
  )
}

export async function listOracleFusionExpenseReports(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionListExpenseReportsInputSchema.parse(rawInput)
  return executeList(
    input,
    'expenseReports',
    oracleFusionExpenseReportSchema,
    ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
    signal,
    (item) => ({
      expenseReportUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: 'expenseReports',
      }),
      ...projectFields(item, ORACLE_FUSION_EXPENSE_REPORT_FIELDS),
    })
  )
}

export async function getOracleFusionExpenseReport(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionGetExpenseReportInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}`,
    oracleFusionExpenseReportSchema,
    ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
    'expenseReport',
    signal,
    (item) => ({
      expenseReportUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
        family: 'fscm',
        relativePath: 'expenseReports',
      }),
      ...projectFields(item, ORACLE_FUSION_EXPENSE_REPORT_FIELDS),
    })
  )
}

export async function listOracleFusionGlLedgers(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionListGlLedgersInputSchema.parse(rawInput)
  return executeList(
    input,
    `ledgersLOV`,
    oracleFusionGlLedgerSchema,
    ORACLE_FUSION_GL_LEDGER_FIELDS,
    signal,
    (item) => {
      const id = item.LedgerId
      if (id !== null && id !== undefined) {
        validateOracleFusionSelfLink(item, input.instanceUrl, {
          family: 'fscm',
          relativePath: `ledgersLOV/${encodeOracleFusionPathSegment(id)}`,
        })
      }
      return projectFields(item, ORACLE_FUSION_GL_LEDGER_FIELDS)
    }
  )
}

export async function getOracleFusionGlLedger(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionGetGlLedgerInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `ledgersLOV/${encodeOracleFusionPathSegment(input.glLedgerId)}`,
    oracleFusionGlLedgerSchema,
    ORACLE_FUSION_GL_LEDGER_FIELDS,
    'glLedger',
    signal
  )
}

export async function listOracleFusionGlJournalBatches(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionListGlJournalBatchesInputSchema.parse(rawInput)
  return executeList(
    input,
    `journalBatches`,
    oracleFusionGlJournalBatchSchema,
    ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS,
    signal,
    (item) => {
      const id = item.JeBatchId
      if (id !== null && id !== undefined) {
        validateOracleFusionSelfLink(item, input.instanceUrl, {
          family: 'fscm',
          relativePath: `journalBatches/${encodeOracleFusionPathSegment(id)}`,
        })
      }
      return projectFields(item, ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS)
    }
  )
}

export async function getOracleFusionGlJournalBatch(rawInput: unknown, signal?: AbortSignal) {
  const input = oracleFusionGetGlJournalBatchInputSchema.parse(rawInput)
  return executeDetail(
    input,
    `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}`,
    oracleFusionGlJournalBatchSchema,
    ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS,
    'glJournalBatch',
    signal
  )
}

export async function executeOracleFusionFinancialsOperation(
  toolId: OracleFusionFinancialsToolId,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  switch (toolId) {
    case 'oracle_fusion_financials_list_gl_ledgers':
      return listOracleFusionGlLedgers(rawInput, signal)
    case 'oracle_fusion_financials_get_gl_ledger':
      return getOracleFusionGlLedger(rawInput, signal)
    case 'oracle_fusion_financials_list_gl_journal_batches':
      return listOracleFusionGlJournalBatches(rawInput, signal)
    case 'oracle_fusion_financials_get_gl_journal_batch':
      return getOracleFusionGlJournalBatch(rawInput, signal)
    case 'oracle_fusion_financials_delete_gl_journal_batch': {
      const input = oracleFusionDeleteGlJournalBatchInputSchema.parse(rawInput)
      await requestOracleFusionEmpty(
        input,
        {
          address: {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}`,
          },
          method: 'DELETE',
        },
        signal
      )
      return { success: true, output: { deleted: true, id: input.glJournalBatchId } }
    }
    case 'oracle_fusion_financials_list_gl_journal_headers': {
      const input = oracleFusionListGlJournalHeadersInputSchema.parse(rawInput)
      return executeList(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders`,
        oracleFusionGlJournalHeaderSchema,
        ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS,
        signal,
        (item) => ({
          glJournalHeaderUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_gl_journal_header': {
      const input = oracleFusionGetGlJournalHeaderInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders/${encodeOracleFusionPathSegment(input.glJournalHeaderUniqId)}`,
        oracleFusionGlJournalHeaderSchema,
        ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS,
        'glJournalHeader',
        signal,
        (item) => ({
          glJournalHeaderUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_gl_journal_lines': {
      const input = oracleFusionListGlJournalLinesInputSchema.parse(rawInput)
      return executeList(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders/${encodeOracleFusionPathSegment(input.glJournalHeaderUniqId)}/child/journalLines`,
        oracleFusionGlJournalLineSchema,
        ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS,
        signal,
        (item) => ({
          glJournalLineUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders/${encodeOracleFusionPathSegment(input.glJournalHeaderUniqId)}/child/journalLines`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_gl_journal_line': {
      const input = oracleFusionGetGlJournalLineInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders/${encodeOracleFusionPathSegment(input.glJournalHeaderUniqId)}/child/journalLines/${encodeOracleFusionPathSegment(input.glJournalLineUniqId)}`,
        oracleFusionGlJournalLineSchema,
        ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS,
        'glJournalLine',
        signal,
        (item) => ({
          glJournalLineUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalHeaders/${encodeOracleFusionPathSegment(input.glJournalHeaderUniqId)}/child/journalLines`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_gl_journal_errors': {
      const input = oracleFusionListGlJournalErrorsInputSchema.parse(rawInput)
      return executeList(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalErrors`,
        oracleFusionGlJournalErrorSchema,
        ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS,
        signal,
        (item) => ({
          glJournalErrorUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalErrors`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_gl_journal_error': {
      const input = oracleFusionGetGlJournalErrorInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalErrors/${encodeOracleFusionPathSegment(input.glJournalErrorUniqId)}`,
        oracleFusionGlJournalErrorSchema,
        ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS,
        'glJournalError',
        signal,
        (item) => ({
          glJournalErrorUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalErrors`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_gl_journal_action_logs': {
      const input = oracleFusionListGlJournalActionLogsInputSchema.parse(rawInput)
      return executeList(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalActionLogs`,
        oracleFusionGlJournalActionLogSchema,
        ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS,
        signal,
        (item) => ({
          glJournalActionLogUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalActionLogs`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_gl_journal_action_log': {
      const input = oracleFusionGetGlJournalActionLogInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalActionLogs/${encodeOracleFusionPathSegment(input.glJournalActionLogUniqId)}`,
        oracleFusionGlJournalActionLogSchema,
        ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS,
        'glJournalActionLog',
        signal,
        (item) => ({
          glJournalActionLogUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `journalBatches/${encodeOracleFusionPathSegment(input.glJournalBatchId)}/child/journalActionLogs`,
          }),
          ...projectFields(item, ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_gl_balances': {
      const input = oracleFusionListGlBalancesInputSchema.parse(rawInput)
      return executeList(
        input,
        `ledgerBalances`,
        oracleFusionGlBalanceSchema,
        ORACLE_FUSION_GL_BALANCE_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_list_expense_reports':
      return listOracleFusionExpenseReports(rawInput, signal)
    case 'oracle_fusion_financials_get_expense_report':
      return getOracleFusionExpenseReport(rawInput, signal)
    case 'oracle_fusion_financials_create_expense_report': {
      const input = oracleFusionCreateExpenseReportInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports`,
        'POST',
        filterUndefined({
          OrgId: input.orgId,
          PersonId: input.personId,
          AssignmentId: input.assignmentId,
          PreparerId: input.preparerId,
          Purpose: input.purpose,
          ExpenseReportNumber: input.expenseReportNumber,
          ExpenseReportDate: input.expenseReportDate,
          ReimbursementCurrencyCode: input.reimbursementCurrencyCode,
          ExchangeRateType: input.exchangeRateType,
          PaymentMethodCode: input.paymentMethodCode,
          OverrideApproverId: input.overrideApproverId,
          UnappliedAdvancesJust: input.unappliedAdvancesJust,
          UnappliedCashAdvReason: input.unappliedCashAdvReason,
        }),
        oracleFusionExpenseReportSchema,
        ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
        'expenseReport',
        'ExpenseReportId',
        signal,
        'expenseReportUniqId'
      )
    }
    case 'oracle_fusion_financials_update_expense_report': {
      const input = oracleFusionUpdateExpenseReportInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}`,
        'PATCH',
        filterUndefined({
          OrgId: input.orgId,
          Purpose: input.purpose,
          ExpenseReportDate: input.expenseReportDate,
          ReimbursementCurrencyCode: input.reimbursementCurrencyCode,
          ExchangeRateType: input.exchangeRateType,
          PaymentMethodCode: input.paymentMethodCode,
          OverrideApproverId: input.overrideApproverId,
          UnappliedAdvancesJust: input.unappliedAdvancesJust,
          UnappliedCashAdvReason: input.unappliedCashAdvReason,
        }),
        oracleFusionExpenseReportSchema,
        ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
        'expenseReport',
        'ExpenseReportId',
        signal,
        'expenseReportUniqId'
      )
    }
    case 'oracle_fusion_financials_submit_expense_report': {
      const input = oracleFusionSubmitExpenseReportInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/action/submit`,
        {},
        'S',
        signal
      )
    }
    case 'oracle_fusion_financials_remove_expense_report_cash_advance': {
      const input = oracleFusionRemoveExpenseReportCashAdvanceInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/action/revertCashAdvances`,
        { cashAdvanceNumber: input.cashAdvanceNumber },
        'Y',
        signal
      )
    }
    case 'oracle_fusion_financials_list_expense_lines': {
      const input = oracleFusionListExpenseLinesInputSchema.parse(rawInput)
      return executeList(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense`,
        oracleFusionExpenseLineSchema,
        ORACLE_FUSION_EXPENSE_LINE_FIELDS,
        signal,
        (item) => ({
          expenseLineUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense`,
          }),
          ...projectFields(item, ORACLE_FUSION_EXPENSE_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_expense_line': {
      const input = oracleFusionGetExpenseLineInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}`,
        oracleFusionExpenseLineSchema,
        ORACLE_FUSION_EXPENSE_LINE_FIELDS,
        'expenseLine',
        signal,
        (item) => ({
          expenseLineUniqId: extractOracleFusionOpaqueKey(item, input.instanceUrl, {
            family: 'fscm',
            relativePath: `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense`,
          }),
          ...projectFields(item, ORACLE_FUSION_EXPENSE_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_create_expense_line': {
      const input = oracleFusionCreateExpenseLineInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense`,
        'POST',
        filterUndefined({
          AssignmentId: input.assignmentId,
          OrgId: input.orgId,
          PersonId: input.personId,
          TicketClass: input.ticketClass,
          ExpenseTypeId: input.expenseTypeId,
          ExpenseTemplateId: input.expenseTemplateId,
          Description: input.description,
          Justification: input.justification,
          ReceiptAmount: input.receiptAmount,
          ReceiptCurrencyCode: input.receiptCurrencyCode,
          ReceiptDate: input.receiptDate,
          MerchantName: input.merchantName,
          StartDate: input.startDate,
          EndDate: input.endDate,
          ExchangeRate: input.exchangeRate,
          ReimbursementCurrencyCode: input.reimbursementCurrencyCode,
          ItemizationParentExpenseId: input.itemizationParentExpenseId,
          ReceiptMissingFlag: input.receiptMissingFlag,
          Location: input.location,
          CountryCode: input.countryCode,
          ExpenseCategoryCode: input.expenseCategoryCode,
          ExpenseSource: input.expenseSource,
          NumberOfDays: input.numberOfDays,
          NumberOfAttendees: input.numberOfAttendees,
          TripDistance: input.tripDistance,
          DistanceUnitCode: input.distanceUnitCode,
          TicketClassCode: input.ticketClassCode,
          TicketNumber: input.ticketNumber,
        }),
        oracleFusionExpenseLineSchema,
        ORACLE_FUSION_EXPENSE_LINE_FIELDS,
        'expenseLine',
        'ExpenseId',
        signal,
        'expenseLineUniqId'
      )
    }
    case 'oracle_fusion_financials_update_expense_line': {
      const input = oracleFusionUpdateExpenseLineInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}`,
        'PATCH',
        filterUndefined({
          AssignmentId: input.assignmentId,
          OrgId: input.orgId,
          PersonId: input.personId,
          TicketClass: input.ticketClass,
          ExpenseTypeId: input.expenseTypeId,
          ExpenseTemplateId: input.expenseTemplateId,
          Description: input.description,
          Justification: input.justification,
          ReceiptAmount: input.receiptAmount,
          ReceiptCurrencyCode: input.receiptCurrencyCode,
          ReceiptDate: input.receiptDate,
          MerchantName: input.merchantName,
          StartDate: input.startDate,
          EndDate: input.endDate,
          ExchangeRate: input.exchangeRate,
          ReimbursementCurrencyCode: input.reimbursementCurrencyCode,
          ItemizationParentExpenseId: input.itemizationParentExpenseId,
          ReceiptMissingFlag: input.receiptMissingFlag,
          Location: input.location,
          CountryCode: input.countryCode,
          ExpenseCategoryCode: input.expenseCategoryCode,
          ExpenseSource: input.expenseSource,
          NumberOfDays: input.numberOfDays,
          NumberOfAttendees: input.numberOfAttendees,
          TripDistance: input.tripDistance,
          DistanceUnitCode: input.distanceUnitCode,
          TicketClassCode: input.ticketClassCode,
          TicketNumber: input.ticketNumber,
        }),
        oracleFusionExpenseLineSchema,
        ORACLE_FUSION_EXPENSE_LINE_FIELDS,
        'expenseLine',
        'ExpenseId',
        signal,
        'expenseLineUniqId'
      )
    }
    case 'oracle_fusion_financials_list_expense_distributions': {
      const input = oracleFusionListExpenseDistributionsInputSchema.parse(rawInput)
      return executeList(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseDistribution`,
        oracleFusionExpenseDistributionSchema,
        ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_expense_distribution': {
      const input = oracleFusionGetExpenseDistributionInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseDistribution/${encodeOracleFusionPathSegment(input.expenseDistributionId)}`,
        oracleFusionExpenseDistributionSchema,
        ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
        'expenseDistribution',
        signal
      )
    }
    case 'oracle_fusion_financials_create_expense_distribution': {
      const input = oracleFusionCreateExpenseDistributionInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseDistribution`,
        'POST',
        filterUndefined({
          ExpenseId: input.expenseId,
          OrgId: input.orgId,
          CodeCombinationId: input.codeCombinationId,
          Company: input.company,
          CostCenter: input.costCenter,
          ReimbursableAmount: input.reimbursableAmount,
        }),
        oracleFusionExpenseDistributionSchema,
        ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
        'expenseDistribution',
        'ExpenseDistId',
        signal
      )
    }
    case 'oracle_fusion_financials_update_expense_distribution': {
      const input = oracleFusionUpdateExpenseDistributionInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseDistribution/${encodeOracleFusionPathSegment(input.expenseDistributionId)}`,
        'PATCH',
        filterUndefined({
          ExpenseId: input.expenseId,
          OrgId: input.orgId,
          CodeCombinationId: input.codeCombinationId,
          Company: input.company,
          CostCenter: input.costCenter,
          ReimbursableAmount: input.reimbursableAmount,
        }),
        oracleFusionExpenseDistributionSchema,
        ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS,
        'expenseDistribution',
        'ExpenseDistId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_expense_itemizations': {
      const input = oracleFusionListExpenseItemizationsInputSchema.parse(rawInput)
      return executeList(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseItemization`,
        oracleFusionExpenseItemizationSchema,
        ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_expense_itemization': {
      const input = oracleFusionGetExpenseItemizationInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseItemization/${encodeOracleFusionPathSegment(input.expenseItemizationId)}`,
        oracleFusionExpenseItemizationSchema,
        ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
        'expenseItemization',
        signal
      )
    }
    case 'oracle_fusion_financials_create_expense_itemization': {
      const input = oracleFusionCreateExpenseItemizationInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseItemization`,
        'POST',
        filterUndefined({
          AssignmentId: input.assignmentId,
          OrgId: input.orgId,
          PersonId: input.personId,
          ExpenseTypeId: input.expenseTypeId,
          ExpenseTemplateId: input.expenseTemplateId,
          ItemizationParentExpenseId: input.itemizationParentExpenseId,
          Description: input.description,
          Justification: input.justification,
          ReceiptAmount: input.receiptAmount,
          ReceiptCurrencyCode: input.receiptCurrencyCode,
          ReceiptDate: input.receiptDate,
          MerchantName: input.merchantName,
          StartDate: input.startDate,
          EndDate: input.endDate,
          ExchangeRate: input.exchangeRate,
          ReimbursementCurrencyCode: input.reimbursementCurrencyCode,
          ReceiptMissingFlag: input.receiptMissingFlag,
          Location: input.location,
          ExpenseCategoryCode: input.expenseCategoryCode,
          NumberOfDays: input.numberOfDays,
          NumberOfAttendees: input.numberOfAttendees,
        }),
        oracleFusionExpenseItemizationSchema,
        ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
        'expenseItemization',
        'ExpenseId',
        signal
      )
    }
    case 'oracle_fusion_financials_update_expense_itemization': {
      const input = oracleFusionUpdateExpenseItemizationInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/ExpenseItemization/${encodeOracleFusionPathSegment(input.expenseItemizationId)}`,
        'PATCH',
        filterUndefined({
          AssignmentId: input.assignmentId,
          OrgId: input.orgId,
          PersonId: input.personId,
          ExpenseTypeId: input.expenseTypeId,
          ExpenseTemplateId: input.expenseTemplateId,
          ItemizationParentExpenseId: input.itemizationParentExpenseId,
          Description: input.description,
          Justification: input.justification,
          ReceiptAmount: input.receiptAmount,
          ReceiptCurrencyCode: input.receiptCurrencyCode,
          ReceiptDate: input.receiptDate,
          MerchantName: input.merchantName,
          StartDate: input.startDate,
          EndDate: input.endDate,
          ExchangeRate: input.exchangeRate,
          ReimbursementCurrencyCode: input.reimbursementCurrencyCode,
          ReceiptMissingFlag: input.receiptMissingFlag,
          Location: input.location,
          ExpenseCategoryCode: input.expenseCategoryCode,
          NumberOfDays: input.numberOfDays,
          NumberOfAttendees: input.numberOfAttendees,
        }),
        oracleFusionExpenseItemizationSchema,
        ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS,
        'expenseItemization',
        'ExpenseId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_expense_report_processing_details': {
      const input = oracleFusionListExpenseReportProcessingDetailsInputSchema.parse(rawInput)
      return executeList(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/processingDetails`,
        oracleFusionExpenseReportProcessingDetailSchema,
        ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS,
        signal,
        (item) => ({
          expenseReportProcessingDetailUniqId: extractOracleFusionOpaqueKey(
            item,
            input.instanceUrl,
            {
              family: 'fscm',
              relativePath: `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/processingDetails`,
            }
          ),
          ...projectFields(item, ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_expense_report_processing_detail': {
      const input = oracleFusionGetExpenseReportProcessingDetailInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/processingDetails/${encodeOracleFusionPathSegment(input.expenseReportProcessingDetailUniqId)}`,
        oracleFusionExpenseReportProcessingDetailSchema,
        ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS,
        'expenseReportProcessingDetail',
        signal,
        (item) => ({
          expenseReportProcessingDetailUniqId: extractOracleFusionOpaqueKey(
            item,
            input.instanceUrl,
            {
              family: 'fscm',
              relativePath: `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/processingDetails`,
            }
          ),
          ...projectFields(item, ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_expense_report_payments': {
      const input = oracleFusionListExpenseReportPaymentsInputSchema.parse(rawInput)
      return executeList(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/ExpensePayment`,
        oracleFusionExpenseReportPaymentSchema,
        ORACLE_FUSION_EXPENSE_REPORT_PAYMENT_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_expense_report_payment': {
      const input = oracleFusionGetExpenseReportPaymentInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/ExpensePayment/${encodeOracleFusionPathSegment(input.expenseReportPaymentId)}`,
        oracleFusionExpenseReportPaymentSchema,
        ORACLE_FUSION_EXPENSE_REPORT_PAYMENT_FIELDS,
        'expenseReportPayment',
        signal
      )
    }
    case 'oracle_fusion_financials_list_expense_line_errors': {
      const input = oracleFusionListExpenseLineErrorsInputSchema.parse(rawInput)
      return executeList(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/expenseErrors`,
        oracleFusionExpenseLineErrorSchema,
        ORACLE_FUSION_EXPENSE_LINE_ERROR_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_expense_line_error': {
      const input = oracleFusionGetExpenseLineErrorInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `expenseReports/${encodeOracleFusionPathSegment(input.expenseReportUniqId)}/child/Expense/${encodeOracleFusionPathSegment(input.expenseLineUniqId)}/child/expenseErrors/${encodeOracleFusionPathSegment(input.expenseLineErrorSequence)}`,
        oracleFusionExpenseLineErrorSchema,
        ORACLE_FUSION_EXPENSE_LINE_ERROR_FIELDS,
        'expenseLineError',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_invoices':
      return listOracleFusionReceivablesInvoices(rawInput, signal)
    case 'oracle_fusion_financials_get_receivables_invoice':
      return getOracleFusionReceivablesInvoice(rawInput, signal)
    case 'oracle_fusion_financials_create_receivables_invoice': {
      const input = oracleFusionCreateReceivablesInvoiceInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesInvoices`,
        'POST',
        filterUndefined({
          BusinessUnit: input.businessUnit,
          TransactionNumber: input.transactionNumber,
          TransactionDate: input.transactionDate,
          AccountingDate: input.accountingDate,
          BillToCustomerName: input.billToCustomerName,
          BillToCustomerNumber: input.billToCustomerNumber,
          BillToSite: input.billToSite,
          InvoiceCurrencyCode: input.invoiceCurrencyCode,
          InvoiceStatus: input.invoiceStatus,
          PaymentTerms: input.paymentTerms,
          TransactionSource: input.transactionSource,
          TransactionType: input.transactionType,
          Comments: input.comments,
          PurchaseOrder: input.purchaseOrder,
          ConversionRateType: input.conversionRateType,
          ConversionRate: input.conversionRate,
          ConversionDate: input.conversionDate,
          receivablesInvoiceLines: input.lines,
          receivablesInvoiceDistributions: input.distributions,
        }),
        oracleFusionReceivablesInvoiceSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
        'receivablesInvoice',
        'CustomerTransactionId',
        signal
      )
    }
    case 'oracle_fusion_financials_update_receivables_invoice': {
      const input = oracleFusionUpdateReceivablesInvoiceInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}`,
        'PATCH',
        filterUndefined({
          InvoiceStatus: input.invoiceStatus,
          PaymentTerms: input.paymentTerms,
          TransactionDate: input.transactionDate,
        }),
        oracleFusionReceivablesInvoiceSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
        'receivablesInvoice',
        'CustomerTransactionId',
        signal
      )
    }
    case 'oracle_fusion_financials_delete_receivables_invoice': {
      const input = oracleFusionDeleteReceivablesInvoiceInputSchema.parse(rawInput)
      await requestOracleFusionEmpty(
        input,
        {
          address: {
            family: 'fscm',
            relativePath: `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}`,
          },
          method: 'DELETE',
        },
        signal
      )
      return { success: true, output: { deleted: true, id: input.receivablesInvoiceId } }
    }
    case 'oracle_fusion_financials_approve_receivables_invoice': {
      const input = oracleFusionApproveReceivablesInvoiceInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/action/approve`,
        filterUndefined({ comment: input.comment }),
        'SUCCESS',
        signal
      )
    }
    case 'oracle_fusion_financials_rework_receivables_invoice': {
      const input = oracleFusionReworkReceivablesInvoiceInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/action/rework`,
        filterUndefined({ comment: input.comment }),
        'SUCCESS',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_invoice_lines': {
      const input = oracleFusionListReceivablesInvoiceLinesInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceLines`,
        oracleFusionReceivablesInvoiceLineSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_invoice_line': {
      const input = oracleFusionGetReceivablesInvoiceLineInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceLines/${encodeOracleFusionPathSegment(input.receivablesInvoiceLineId)}`,
        oracleFusionReceivablesInvoiceLineSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
        'receivablesInvoiceLine',
        signal
      )
    }
    case 'oracle_fusion_financials_create_receivables_invoice_line': {
      const input = oracleFusionCreateReceivablesInvoiceLineInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceLines`,
        'POST',
        filterUndefined({
          LineNumber: input.lineNumber,
          Description: input.description,
          ItemNumber: input.itemNumber,
          MemoLine: input.memoLine,
          LineAmount: input.lineAmount,
          Quantity: input.quantity,
          UnitSellingPrice: input.unitSellingPrice,
          UnitOfMeasure: input.unitOfMeasure,
          AccountingRule: input.accountingRule,
          AccountingRuleDuration: input.accountingRuleDuration,
          RuleStartDate: input.ruleStartDate,
          RuleEndDate: input.ruleEndDate,
          TaxClassificationCode: input.taxClassificationCode,
          SalesOrder: input.salesOrder,
        }),
        oracleFusionReceivablesInvoiceLineSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
        'receivablesInvoiceLine',
        'CustomerTransactionLineId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_invoice_distributions': {
      const input = oracleFusionListReceivablesInvoiceDistributionsInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceDistributions`,
        oracleFusionReceivablesInvoiceDistributionSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_invoice_distribution': {
      const input = oracleFusionGetReceivablesInvoiceDistributionInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceDistributions/${encodeOracleFusionPathSegment(input.receivablesInvoiceDistributionId)}`,
        oracleFusionReceivablesInvoiceDistributionSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS,
        'receivablesInvoiceDistribution',
        signal
      )
    }
    case 'oracle_fusion_financials_create_receivables_invoice_distribution': {
      const input = oracleFusionCreateReceivablesInvoiceDistributionInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceDistributions`,
        'POST',
        filterUndefined({
          AccountClass: input.accountClass,
          AccountCombination: input.accountCombination,
          AccountedAmount: input.accountedAmount,
          Amount: input.amount,
          InvoiceLineNumber: input.invoiceLineNumber,
          DetailedTaxLineNumber: input.detailedTaxLineNumber,
          Percent: input.percent,
          Comments: input.comments,
        }),
        oracleFusionReceivablesInvoiceDistributionSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS,
        'receivablesInvoiceDistribution',
        'DistributionId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_invoice_installments': {
      const input = oracleFusionListReceivablesInvoiceInstallmentsInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceInstallments`,
        oracleFusionReceivablesInvoiceInstallmentSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_invoice_installment': {
      const input = oracleFusionGetReceivablesInvoiceInstallmentInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceInstallments/${encodeOracleFusionPathSegment(input.receivablesInvoiceInstallmentId)}`,
        oracleFusionReceivablesInvoiceInstallmentSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
        'receivablesInvoiceInstallment',
        signal
      )
    }
    case 'oracle_fusion_financials_update_receivables_invoice_installment': {
      const input = oracleFusionUpdateReceivablesInvoiceInstallmentInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesInvoices/${encodeOracleFusionPathSegment(input.receivablesInvoiceId)}/child/receivablesInvoiceInstallments/${encodeOracleFusionPathSegment(input.receivablesInvoiceInstallmentId)}`,
        'PATCH',
        filterUndefined({
          InstallmentDueDate: input.installmentDueDate,
          OriginalAmount: input.originalAmount,
        }),
        oracleFusionReceivablesInvoiceInstallmentSchema,
        ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
        'receivablesInvoiceInstallment',
        'InstallmentId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_credit_memos':
      return listOracleFusionReceivablesCreditMemos(rawInput, signal)
    case 'oracle_fusion_financials_get_receivables_credit_memo':
      return getOracleFusionReceivablesCreditMemo(rawInput, signal)
    case 'oracle_fusion_financials_create_receivables_credit_memo': {
      const input = oracleFusionCreateReceivablesCreditMemoInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesCreditMemos`,
        'POST',
        filterUndefined({
          BusinessUnit: input.businessUnit,
          TransactionNumber: input.transactionNumber,
          TransactionDate: input.transactionDate,
          AccountingDate: input.accountingDate,
          BillToCustomerName: input.billToCustomerName,
          BillToCustomerNumber: input.billToCustomerNumber,
          BillToSite: input.billToSite,
          CreditMemoCurrency: input.creditMemoCurrency,
          CreditMemoStatus: input.creditMemoStatus,
          CreditReason: input.creditReason,
          FreightCreditAmount: input.freightCreditAmount,
          TransactionSource: input.transactionSource,
          TransactionType: input.transactionType,
          CreditMemoComments: input.creditMemoComments,
          ConversionRate: input.conversionRate,
          ConversionRateType: input.conversionRateType,
          ConversionRateDate: input.conversionRateDate,
          receivablesCreditMemoLines: input.lines,
          receivablesCreditMemoDistributions: input.distributions,
        }),
        oracleFusionReceivablesCreditMemoSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
        'receivablesCreditMemo',
        'CustomerTransactionId',
        signal
      )
    }
    case 'oracle_fusion_financials_update_receivables_credit_memo': {
      const input = oracleFusionUpdateReceivablesCreditMemoInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}`,
        'PATCH',
        filterUndefined({
          AllowCompletion: input.allowCompletion,
          ControlCompletionReason: input.controlCompletionReason,
          CreditMemoStatus: input.creditMemoStatus,
          RecipientEmail: input.recipientEmail,
          TransactionType: input.transactionType,
        }),
        oracleFusionReceivablesCreditMemoSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
        'receivablesCreditMemo',
        'CustomerTransactionId',
        signal
      )
    }
    case 'oracle_fusion_financials_approve_receivables_credit_memo': {
      const input = oracleFusionApproveReceivablesCreditMemoInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/action/approve`,
        filterUndefined({ comment: input.comment }),
        'SUCCESS',
        signal
      )
    }
    case 'oracle_fusion_financials_rework_receivables_credit_memo': {
      const input = oracleFusionReworkReceivablesCreditMemoInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/action/rework`,
        filterUndefined({ comment: input.comment }),
        'SUCCESS',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_credit_memo_lines': {
      const input = oracleFusionListReceivablesCreditMemoLinesInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/child/receivablesCreditMemoLines`,
        oracleFusionReceivablesCreditMemoLineSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_credit_memo_line': {
      const input = oracleFusionGetReceivablesCreditMemoLineInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/child/receivablesCreditMemoLines/${encodeOracleFusionPathSegment(input.receivablesCreditMemoLineId)}`,
        oracleFusionReceivablesCreditMemoLineSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS,
        'receivablesCreditMemoLine',
        signal
      )
    }
    case 'oracle_fusion_financials_create_receivables_credit_memo_line': {
      const input = oracleFusionCreateReceivablesCreditMemoLineInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/child/receivablesCreditMemoLines`,
        'POST',
        filterUndefined({
          LineNumber: input.lineNumber,
          LineDescription: input.lineDescription,
          ItemNumber: input.itemNumber,
          MemoLine: input.memoLine,
          LineAmountCredit: input.lineAmountCredit,
          LineQuantityCredit: input.lineQuantityCredit,
          UnitSellingPrice: input.unitSellingPrice,
          UnitOfMeasure: input.unitOfMeasure,
          LineCreditReason: input.lineCreditReason,
          LineFreightCreditAmount: input.lineFreightCreditAmount,
          TaxClassificationCode: input.taxClassificationCode,
        }),
        oracleFusionReceivablesCreditMemoLineSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS,
        'receivablesCreditMemoLine',
        'CustomerTransactionLineId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_credit_memo_distributions': {
      const input = oracleFusionListReceivablesCreditMemoDistributionsInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/child/receivablesCreditMemoDistributions`,
        oracleFusionReceivablesCreditMemoDistributionSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_credit_memo_distribution': {
      const input = oracleFusionGetReceivablesCreditMemoDistributionInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/child/receivablesCreditMemoDistributions/${encodeOracleFusionPathSegment(input.receivablesCreditMemoDistributionId)}`,
        oracleFusionReceivablesCreditMemoDistributionSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS,
        'receivablesCreditMemoDistribution',
        signal
      )
    }
    case 'oracle_fusion_financials_create_receivables_credit_memo_distribution': {
      const input = oracleFusionCreateReceivablesCreditMemoDistributionInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `receivablesCreditMemos/${encodeOracleFusionPathSegment(input.receivablesCreditMemoId)}/child/receivablesCreditMemoDistributions`,
        'POST',
        filterUndefined({
          AccountClass: input.accountClass,
          AccountCombination: input.accountCombination,
          AccountedAmount: input.accountedAmount,
          Amount: input.amount,
          CreditMemoLineNumber: input.creditMemoLineNumber,
          DetailedTaxLineNumber: input.detailedTaxLineNumber,
          Percent: input.percent,
          Comments: input.comments,
        }),
        oracleFusionReceivablesCreditMemoDistributionSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS,
        'receivablesCreditMemoDistribution',
        'DistributionId',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_receipts':
      return listOracleFusionReceivablesReceipts(rawInput, signal)
    case 'oracle_fusion_financials_get_receivables_receipt':
      return getOracleFusionReceivablesReceipt(rawInput, signal)
    case 'oracle_fusion_financials_create_receivables_receipt': {
      const input = oracleFusionCreateReceivablesReceiptInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `standardReceipts`,
        'POST',
        filterUndefined({
          Amount: input.amount,
          BusinessUnit: input.businessUnit,
          Currency: input.currency,
          ReceiptDate: input.receiptDate,
          ReceiptMethod: input.receiptMethod,
          ReceiptNumber: input.receiptNumber,
          AccountingDate: input.accountingDate,
          CustomerAccountNumber: input.customerAccountNumber,
          CustomerName: input.customerName,
          CustomerSite: input.customerSite,
          Comments: input.comments,
          ConversionRate: input.conversionRate,
          ConversionRateType: input.conversionRateType,
          ConversionDate: input.conversionDate,
          MaturityDate: input.maturityDate,
          StructuredPaymentReference: input.structuredPaymentReference,
        }),
        oracleFusionReceivablesReceiptSchema,
        ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
        'receivablesReceipt',
        'StandardReceiptId',
        signal
      )
    }
    case 'oracle_fusion_financials_update_receivables_receipt': {
      const input = oracleFusionUpdateReceivablesReceiptInputSchema.parse(rawInput)
      return executeFinancialsWrite(
        input,
        `standardReceipts/${encodeOracleFusionPathSegment(input.receivablesReceiptId)}`,
        'PATCH',
        filterUndefined({
          Amount: input.amount,
          Currency: input.currency,
          ReceiptDate: input.receiptDate,
          ReceiptMethod: input.receiptMethod,
          ReceiptNumber: input.receiptNumber,
          AccountingDate: input.accountingDate,
          CustomerAccountNumber: input.customerAccountNumber,
          CustomerName: input.customerName,
          CustomerSite: input.customerSite,
          Comments: input.comments,
          ConversionRate: input.conversionRate,
          ConversionRateType: input.conversionRateType,
          ConversionDate: input.conversionDate,
          MaturityDate: input.maturityDate,
          StructuredPaymentReference: input.structuredPaymentReference,
        }),
        oracleFusionReceivablesReceiptSchema,
        ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
        'receivablesReceipt',
        'StandardReceiptId',
        signal
      )
    }
    case 'oracle_fusion_financials_delete_receivables_receipt': {
      const input = oracleFusionDeleteReceivablesReceiptInputSchema.parse(rawInput)
      await requestOracleFusionEmpty(
        input,
        {
          address: {
            family: 'fscm',
            relativePath: `standardReceipts/${encodeOracleFusionPathSegment(input.receivablesReceiptId)}`,
          },
          method: 'DELETE',
        },
        signal
      )
      return { success: true, output: { deleted: true, id: input.receivablesReceiptId } }
    }
    case 'oracle_fusion_financials_apply_receivables_receipt': {
      const input = oracleFusionApplyReceivablesReceiptInputSchema.parse(rawInput)
      return executeFinancialsAction(
        input,
        `standardReceipts/${encodeOracleFusionPathSegment(input.receivablesReceiptId)}/action/applyReceipt`,
        filterUndefined({
          appliedPaymentScheduleId: input.appliedPaymentScheduleId,
          amountApplied: input.amountApplied,
          calledFrom: input.calledFrom,
        }),
        'SUCCESS',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_customer_accounts':
      return listOracleFusionReceivablesCustomerAccounts(rawInput, signal)
    case 'oracle_fusion_financials_get_receivables_customer_account':
      return getOracleFusionReceivablesCustomerAccount(rawInput, signal)
    case 'oracle_fusion_financials_list_receivables_customer_account_sites':
      return listOracleFusionReceivablesCustomerAccountSites(rawInput, signal)
    case 'oracle_fusion_financials_get_receivables_customer_account_site':
      return getOracleFusionReceivablesCustomerAccountSite(rawInput, signal)
    case 'oracle_fusion_financials_list_receivables_receipt_applications': {
      const input = oracleFusionListReceivablesReceiptApplicationsInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/standardReceiptApplications`,
        oracleFusionReceivablesReceiptApplicationSchema,
        ORACLE_FUSION_RECEIVABLES_RECEIPT_APPLICATION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_receipt_application': {
      const input = oracleFusionGetReceivablesReceiptApplicationInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/standardReceiptApplications/${encodeOracleFusionPathSegment(input.receivablesReceiptApplicationId)}`,
        oracleFusionReceivablesReceiptApplicationSchema,
        ORACLE_FUSION_RECEIVABLES_RECEIPT_APPLICATION_FIELDS,
        'receivablesReceiptApplication',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_credit_memo_applications': {
      const input = oracleFusionListReceivablesCreditMemoApplicationsInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/creditMemoApplications`,
        oracleFusionReceivablesCreditMemoApplicationSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_APPLICATION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_credit_memo_application': {
      const input = oracleFusionGetReceivablesCreditMemoApplicationInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/creditMemoApplications/${encodeOracleFusionPathSegment(input.receivablesCreditMemoApplicationId)}`,
        oracleFusionReceivablesCreditMemoApplicationSchema,
        ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_APPLICATION_FIELDS,
        'receivablesCreditMemoApplication',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_transaction_payment_schedules': {
      const input =
        oracleFusionListReceivablesTransactionPaymentSchedulesInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/transactionPaymentSchedules`,
        oracleFusionReceivablesTransactionPaymentScheduleSchema,
        ORACLE_FUSION_RECEIVABLES_TRANSACTION_PAYMENT_SCHEDULE_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_transaction_payment_schedule': {
      const input = oracleFusionGetReceivablesTransactionPaymentScheduleInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/transactionPaymentSchedules/${encodeOracleFusionPathSegment(input.receivablesTransactionPaymentScheduleId)}`,
        oracleFusionReceivablesTransactionPaymentScheduleSchema,
        ORACLE_FUSION_RECEIVABLES_TRANSACTION_PAYMENT_SCHEDULE_FIELDS,
        'receivablesTransactionPaymentSchedule',
        signal
      )
    }
    case 'oracle_fusion_financials_list_receivables_transaction_adjustments': {
      const input = oracleFusionListReceivablesTransactionAdjustmentsInputSchema.parse(rawInput)
      return executeList(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/transactionAdjustments`,
        oracleFusionReceivablesTransactionAdjustmentSchema,
        ORACLE_FUSION_RECEIVABLES_TRANSACTION_ADJUSTMENT_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_receivables_transaction_adjustment': {
      const input = oracleFusionGetReceivablesTransactionAdjustmentInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `receivablesCustomerAccountActivities/${encodeOracleFusionPathSegment(input.receivablesCustomerAccountId)}/child/transactionAdjustments/${encodeOracleFusionPathSegment(input.receivablesTransactionAdjustmentId)}`,
        oracleFusionReceivablesTransactionAdjustmentSchema,
        ORACLE_FUSION_RECEIVABLES_TRANSACTION_ADJUSTMENT_FIELDS,
        'receivablesTransactionAdjustment',
        signal
      )
    }

    case 'oracle_fusion_financials_list_payables_invoices': {
      return listOracleFusionInvoices(rawInput, signal)
    }
    case 'oracle_fusion_financials_get_payables_invoice': {
      return getOracleFusionInvoice(rawInput, signal)
    }
    case 'oracle_fusion_financials_list_payables_invoice_lines': {
      const input = oracleFusionInvoiceChildListInputSchema.parse(rawInput)
      const collectionPath = invoiceLineCollectionPath(input.invoiceUniqId)
      return executeList(
        input,
        collectionPath,
        oracleFusionInvoiceLineSchema,
        ORACLE_FUSION_INVOICE_LINE_FIELDS,
        signal,
        (line) => ({
          invoiceLineUniqId: extractOracleFusionOpaqueKey(line, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(line, ORACLE_FUSION_INVOICE_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_payables_invoice_line': {
      const input = oracleFusionGetInvoiceLineInputSchema.parse(rawInput)
      const collectionPath = invoiceLineCollectionPath(input.invoiceUniqId)
      const path = `${collectionPath}/${encodeOracleFusionPathSegment(input.invoiceLineUniqId)}`
      return executeDetail(
        input,
        path,
        oracleFusionInvoiceLineSchema,
        ORACLE_FUSION_INVOICE_LINE_FIELDS,
        'invoiceLine',
        signal,
        (line) => ({
          invoiceLineUniqId: extractOracleFusionOpaqueKey(line, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(line, ORACLE_FUSION_INVOICE_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_payables_invoice_installments': {
      const input = oracleFusionInvoiceChildListInputSchema.parse(rawInput)
      const collectionPath = invoiceInstallmentCollectionPath(input.invoiceUniqId)
      return executeList(
        input,
        collectionPath,
        oracleFusionInstallmentSchema,
        ORACLE_FUSION_INSTALLMENT_FIELDS,
        signal,
        (installment) => ({
          invoiceInstallmentUniqId: extractOracleFusionOpaqueKey(installment, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(installment, ORACLE_FUSION_INSTALLMENT_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_payables_invoice_installment': {
      const input = oracleFusionGetInvoiceInstallmentInputSchema.parse(rawInput)
      const collectionPath = invoiceInstallmentCollectionPath(input.invoiceUniqId)
      const path = `${collectionPath}/${encodeOracleFusionPathSegment(input.invoiceInstallmentUniqId)}`
      return executeDetail(
        input,
        path,
        oracleFusionInstallmentSchema,
        ORACLE_FUSION_INSTALLMENT_FIELDS,
        'invoiceInstallment',
        signal,
        (installment) => ({
          invoiceInstallmentUniqId: extractOracleFusionOpaqueKey(installment, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(installment, ORACLE_FUSION_INSTALLMENT_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_payables_invoice_distributions': {
      const input = oracleFusionInvoiceDistributionListInputSchema.parse(rawInput)
      return executeList(
        input,
        invoiceDistributionCollectionPath(input.invoiceUniqId, input.invoiceLineUniqId),
        oracleFusionInvoiceDistributionSchema,
        ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_payables_invoice_distribution': {
      const input = oracleFusionGetInvoiceDistributionInputSchema.parse(rawInput)
      const path = `${invoiceDistributionCollectionPath(input.invoiceUniqId, input.invoiceLineUniqId)}/${input.invoiceDistributionId}`
      return executeDetail(
        input,
        path,
        oracleFusionInvoiceDistributionSchema,
        ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
        'invoiceDistribution',
        signal
      )
    }
    case 'oracle_fusion_financials_list_payables_applied_prepayments': {
      const input = oracleFusionInvoiceChildListInputSchema.parse(rawInput)
      const collectionPath = prepaymentCollectionPath(input.invoiceUniqId, 'appliedPrepayments')
      return executeList(
        input,
        collectionPath,
        oracleFusionAppliedPrepaymentSchema,
        ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
        signal,
        (prepayment) => ({
          appliedPrepaymentUniqId: extractOracleFusionOpaqueKey(prepayment, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(prepayment, ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_payables_applied_prepayment': {
      const input = oracleFusionGetAppliedPrepaymentInputSchema.parse(rawInput)
      const collectionPath = prepaymentCollectionPath(input.invoiceUniqId, 'appliedPrepayments')
      const path = `${collectionPath}/${encodeOracleFusionPathSegment(input.appliedPrepaymentUniqId)}`
      return executeDetail(
        input,
        path,
        oracleFusionAppliedPrepaymentSchema,
        ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
        'appliedPrepayment',
        signal,
        (prepayment) => ({
          appliedPrepaymentUniqId: extractOracleFusionOpaqueKey(prepayment, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(prepayment, ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_payables_available_prepayments': {
      const input = oracleFusionInvoiceChildListInputSchema.parse(rawInput)
      const collectionPath = prepaymentCollectionPath(input.invoiceUniqId, 'availablePrepayments')
      return executeList(
        input,
        collectionPath,
        oracleFusionAvailablePrepaymentSchema,
        ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
        signal,
        (prepayment) => ({
          availablePrepaymentUniqId: extractOracleFusionOpaqueKey(prepayment, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(prepayment, ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_payables_available_prepayment': {
      const input = oracleFusionGetAvailablePrepaymentInputSchema.parse(rawInput)
      const collectionPath = prepaymentCollectionPath(input.invoiceUniqId, 'availablePrepayments')
      const path = `${collectionPath}/${encodeOracleFusionPathSegment(input.availablePrepaymentUniqId)}`
      return executeDetail(
        input,
        path,
        oracleFusionAvailablePrepaymentSchema,
        ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
        'availablePrepayment',
        signal,
        (prepayment) => ({
          availablePrepaymentUniqId: extractOracleFusionOpaqueKey(prepayment, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(prepayment, ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_list_payables_payments': {
      const input = oracleFusionListInputSchema.parse(rawInput)
      return executeList(
        input,
        'payablesPayments',
        oracleFusionPaymentSchema,
        ORACLE_FUSION_PAYMENT_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_payables_payment': {
      const input = oracleFusionGetPaymentInputSchema.parse(rawInput)
      return executeDetail(
        input,
        paymentPath(input.checkId),
        oracleFusionPaymentSchema,
        ORACLE_FUSION_PAYMENT_FIELDS,
        'payment',
        signal
      )
    }
    case 'oracle_fusion_financials_list_payables_payment_related_invoices': {
      const input = oracleFusionPaymentRelatedInvoiceListInputSchema.parse(rawInput)
      return executeList(
        input,
        relatedInvoiceCollectionPath(input.checkId),
        oracleFusionPaymentRelatedInvoiceSchema,
        ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_payables_payment_related_invoice': {
      const input = oracleFusionGetPaymentRelatedInvoiceInputSchema.parse(rawInput)
      const path = `${relatedInvoiceCollectionPath(input.checkId)}/${input.invoicePaymentId}`
      return executeDetail(
        input,
        path,
        oracleFusionPaymentRelatedInvoiceSchema,
        ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
        'paymentRelatedInvoice',
        signal
      )
    }
    case 'oracle_fusion_financials_list_payment_process_requests': {
      const input = oracleFusionListInputSchema.parse(rawInput)
      return executeList(
        input,
        'paymentProcessRequests',
        oracleFusionPaymentProcessRequestSchema,
        ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_payment_process_request': {
      const input = oracleFusionGetPaymentProcessRequestInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `paymentProcessRequests/${input.paymentProcessRequestId}`,
        oracleFusionPaymentProcessRequestSchema,
        ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
        'paymentProcessRequest',
        signal
      )
    }
    case 'oracle_fusion_financials_list_payables_invoice_holds': {
      const input = oracleFusionListInputSchema.parse(rawInput)
      return executeList(
        input,
        'invoiceHolds',
        oracleFusionInvoiceHoldSchema,
        ORACLE_FUSION_INVOICE_HOLD_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_payables_invoice_hold': {
      const input = oracleFusionGetInvoiceHoldInputSchema.parse(rawInput)
      return executeDetail(
        input,
        `invoiceHolds/${input.holdId}`,
        oracleFusionInvoiceHoldSchema,
        ORACLE_FUSION_INVOICE_HOLD_FIELDS,
        'invoiceHold',
        signal
      )
    }
    case 'oracle_fusion_financials_list_payables_payment_terms': {
      const input = oracleFusionListInputSchema.parse(rawInput)
      return executeList(
        input,
        'payablesPaymentTerms',
        oracleFusionPaymentTermSchema,
        ORACLE_FUSION_PAYMENT_TERM_FIELDS,
        signal
      )
    }
    case 'oracle_fusion_financials_get_payables_payment_term': {
      const input = oracleFusionGetPaymentTermInputSchema.parse(rawInput)
      return executeDetail(
        input,
        paymentTermPath(input.termsId),
        oracleFusionPaymentTermSchema,
        ORACLE_FUSION_PAYMENT_TERM_FIELDS,
        'paymentTerm',
        signal
      )
    }
    case 'oracle_fusion_financials_list_payables_payment_term_lines': {
      const input = oracleFusionPaymentTermLineListInputSchema.parse(rawInput)
      const collectionPath = paymentTermLineCollectionPath(input.termsId)
      return executeList(
        input,
        collectionPath,
        oracleFusionPaymentTermLineSchema,
        ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
        signal,
        (line) => ({
          paymentTermLineUniqId: extractOracleFusionOpaqueKey(line, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(line, ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_payables_payment_term_line': {
      const input = oracleFusionGetPaymentTermLineInputSchema.parse(rawInput)
      const collectionPath = paymentTermLineCollectionPath(input.termsId)
      const path = `${collectionPath}/${encodeOracleFusionPathSegment(input.paymentTermLineUniqId)}`
      return executeDetail(
        input,
        path,
        oracleFusionPaymentTermLineSchema,
        ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
        'paymentTermLine',
        signal,
        (line) => ({
          paymentTermLineUniqId: extractOracleFusionOpaqueKey(line, input.instanceUrl, {
            family: 'fscm',
            relativePath: collectionPath,
          }),
          ...projectFields(line, ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS),
        })
      )
    }
  }
}
