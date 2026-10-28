import { filterUndefined } from '@sim/utils/object'
import type { z } from 'zod'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import {
  ORACLE_FUSION_EXPENSE_LINE_FIELDS,
  ORACLE_FUSION_EXPENSE_REPORT_FIELDS,
  ORACLE_FUSION_GL_BALANCE_FIELDS,
  ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS,
  ORACLE_FUSION_GL_LEDGER_FIELDS,
  ORACLE_FUSION_INVOICE_FIELDS,
  ORACLE_FUSION_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_PAYMENT_FIELDS,
  ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS,
  ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS,
  oracleFusionApplyReceivablesReceiptInputSchema,
  oracleFusionApproveReceivablesInvoiceInputSchema,
  oracleFusionCreateExpenseLineInputSchema,
  oracleFusionCreateExpenseReportInputSchema,
  oracleFusionCreateReceivablesCreditMemoInputSchema,
  oracleFusionCreateReceivablesInvoiceInputSchema,
  oracleFusionCreateReceivablesReceiptInputSchema,
  oracleFusionExpenseLineSchema,
  oracleFusionExpenseReportSchema,
  oracleFusionFinancialsActionResultSchema,
  oracleFusionGetExpenseLineInputSchema,
  oracleFusionGetExpenseReportInputSchema,
  oracleFusionGetGlJournalBatchInputSchema,
  oracleFusionGetGlLedgerInputSchema,
  oracleFusionGetInvoiceInputSchema,
  oracleFusionGetInvoiceLineInputSchema,
  oracleFusionGetPaymentInputSchema,
  oracleFusionGetReceivablesCreditMemoInputSchema,
  oracleFusionGetReceivablesInvoiceInputSchema,
  oracleFusionGetReceivablesInvoiceInstallmentInputSchema,
  oracleFusionGetReceivablesInvoiceLineInputSchema,
  oracleFusionGetReceivablesReceiptInputSchema,
  oracleFusionGlBalanceSchema,
  oracleFusionGlJournalBatchSchema,
  oracleFusionGlLedgerSchema,
  oracleFusionInvoiceChildListInputSchema,
  oracleFusionInvoiceLineSchema,
  oracleFusionInvoiceSchema,
  oracleFusionListExpenseLinesInputSchema,
  oracleFusionListExpenseReportsInputSchema,
  oracleFusionListGlBalancesInputSchema,
  oracleFusionListGlJournalBatchesInputSchema,
  oracleFusionListGlLedgersInputSchema,
  oracleFusionListInputSchema,
  oracleFusionListInvoicesInputSchema,
  oracleFusionListReceivablesCreditMemosInputSchema,
  oracleFusionListReceivablesInvoiceInstallmentsInputSchema,
  oracleFusionListReceivablesInvoiceLinesInputSchema,
  oracleFusionListReceivablesInvoicesInputSchema,
  oracleFusionListReceivablesReceiptsInputSchema,
  oracleFusionPaymentSchema,
  oracleFusionReceivablesCreditMemoSchema,
  oracleFusionReceivablesInvoiceInstallmentSchema,
  oracleFusionReceivablesInvoiceLineSchema,
  oracleFusionReceivablesInvoiceSchema,
  oracleFusionReceivablesReceiptSchema,
  oracleFusionSubmitExpenseReportInputSchema,
  oracleFusionUpdateExpenseLineInputSchema,
  oracleFusionUpdateExpenseReportInputSchema,
  oracleFusionUpdateReceivablesInvoiceInputSchema,
  projectFields,
} from '@/lib/internal/oracle-fusion-financials/schema'
import type { OracleFusionFinancialsListResponse } from '@/tools/oracle_fusion_financials/types'
import type { ToolResponse } from '@/tools/types'

const ORACLE_FUSION_FINANCIALS_TOOL_IDS = [
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
] as const

type OracleFusionFinancialsToolId = (typeof ORACLE_FUSION_FINANCIALS_TOOL_IDS)[number]

const TOOL_ID_SET = new Set<string>(ORACLE_FUSION_FINANCIALS_TOOL_IDS)

/** Narrows a tool ID to one of the supported Oracle Fusion Financials operations. */
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

function paymentPath(checkId: string): string {
  return `payablesPayments/${checkId}`
}

async function listOracleFusionInvoices(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionInvoice(rawInput: unknown, signal?: AbortSignal) {
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

async function listOracleFusionReceivablesInvoices(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionReceivablesInvoice(rawInput: unknown, signal?: AbortSignal) {
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

async function listOracleFusionReceivablesCreditMemos(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionReceivablesCreditMemo(rawInput: unknown, signal?: AbortSignal) {
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

async function listOracleFusionReceivablesReceipts(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionReceivablesReceipt(rawInput: unknown, signal?: AbortSignal) {
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

async function listOracleFusionExpenseReports(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionExpenseReport(rawInput: unknown, signal?: AbortSignal) {
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

async function listOracleFusionGlLedgers(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionGlLedger(rawInput: unknown, signal?: AbortSignal) {
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

async function listOracleFusionGlJournalBatches(rawInput: unknown, signal?: AbortSignal) {
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

async function getOracleFusionGlJournalBatch(rawInput: unknown, signal?: AbortSignal) {
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

/**
 * Validates raw inputs and runs a Financials operation with optional cancellation.
 * Returns projected tool output, including unsuccessful Oracle action outcomes.
 * Input validation, provider, and cancellation errors propagate to the caller.
 */
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
  }
}
