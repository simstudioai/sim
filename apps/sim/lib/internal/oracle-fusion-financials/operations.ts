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
  ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
  ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
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
  oracleFusionAppliedPrepaymentSchema,
  oracleFusionAvailablePrepaymentSchema,
  oracleFusionGetAppliedPrepaymentInputSchema,
  oracleFusionGetAvailablePrepaymentInputSchema,
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
  oracleFusionInstallmentSchema,
  oracleFusionInvoiceChildListInputSchema,
  oracleFusionInvoiceDistributionListInputSchema,
  oracleFusionInvoiceDistributionSchema,
  oracleFusionInvoiceHoldSchema,
  oracleFusionInvoiceLineSchema,
  oracleFusionInvoiceSchema,
  oracleFusionListInputSchema,
  oracleFusionListInvoicesInputSchema,
  oracleFusionPaymentProcessRequestSchema,
  oracleFusionPaymentRelatedInvoiceListInputSchema,
  oracleFusionPaymentRelatedInvoiceSchema,
  oracleFusionPaymentSchema,
  oracleFusionPaymentTermLineListInputSchema,
  oracleFusionPaymentTermLineSchema,
  oracleFusionPaymentTermSchema,
  projectFields,
} from '@/lib/internal/oracle-fusion-financials/schema'
import type { OracleFusionFinancialsListResponse } from '@/tools/oracle_fusion_financials/types'
import type { ToolResponse } from '@/tools/types'

export const ORACLE_FUSION_FINANCIALS_TOOL_IDS = [
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

export async function executeOracleFusionFinancialsOperation(
  toolId: OracleFusionFinancialsToolId,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  switch (toolId) {
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
