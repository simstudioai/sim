import type { z } from 'zod'
import {
  OracleFusionFinancialsProviderError,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion-financials/client'
import {
  extractInvoiceUniqId,
  ORACLE_FUSION_FINANCIALS_RESOURCE_PATH,
  ORACLE_FUSION_INSTALLMENT_FIELDS,
  ORACLE_FUSION_INVOICE_FIELDS,
  ORACLE_FUSION_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_PAYMENT_FIELDS,
  oracleFusionGetInvoiceInputSchema,
  oracleFusionGetPaymentInputSchema,
  oracleFusionInstallmentSchema,
  oracleFusionInvoiceChildListInputSchema,
  oracleFusionInvoiceLineSchema,
  oracleFusionInvoiceSchema,
  oracleFusionListEnvelopeSchema,
  oracleFusionListInvoicesInputSchema,
  oracleFusionListPaymentsInputSchema,
  oracleFusionPaymentSchema,
  projectFields,
} from '@/lib/internal/oracle-fusion-financials/schema'
import type { ToolResponse } from '@/tools/types'

export const ORACLE_FUSION_FINANCIALS_TOOL_IDS = [
  'oracle_fusion_financials_list_payables_invoices',
  'oracle_fusion_financials_get_payables_invoice',
  'oracle_fusion_financials_list_payables_invoice_lines',
  'oracle_fusion_financials_list_payables_invoice_installments',
  'oracle_fusion_financials_list_payables_payments',
  'oracle_fusion_financials_get_payables_payment',
] as const

export type OracleFusionFinancialsToolId = (typeof ORACLE_FUSION_FINANCIALS_TOOL_IDS)[number]

const TOOL_ID_SET = new Set<string>(ORACLE_FUSION_FINANCIALS_TOOL_IDS)

export function isOracleFusionFinancialsToolId(
  value: string
): value is OracleFusionFinancialsToolId {
  return TOOL_ID_SET.has(value)
}

function listQuery(
  input: {
    q?: string
    finder?: string
    orderBy?: string
    limit: number
    offset: number
    totalResults: boolean
  },
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
    if (error instanceof OracleFusionFinancialsProviderError) throw error
    throw new OracleFusionFinancialsProviderError(
      'Oracle Fusion Financials returned an unexpected response shape',
      502
    )
  }
}

function projectList<T extends z.ZodType<Record<string, unknown>>>(
  payload: unknown,
  itemSchema: T,
  fields: readonly string[],
  transform?: (item: z.output<T>) => Record<string, unknown>
): ToolResponse {
  return requireProviderResponse(() => {
    const envelope = oracleFusionListEnvelopeSchema.parse(payload)
    const items = envelope.items.map((item) => {
      const parsed = itemSchema.parse(item)
      return transform ? transform(parsed) : projectFields(parsed, fields)
    })
    return {
      success: true,
      output: {
        items,
        count: envelope.count,
        hasMore: envelope.hasMore,
        limit: envelope.limit,
        offset: envelope.offset,
        ...(envelope.totalResults !== undefined ? { totalResults: envelope.totalResults } : {}),
      },
    }
  })
}

export async function executeOracleFusionFinancialsOperation(
  toolId: OracleFusionFinancialsToolId,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  switch (toolId) {
    case 'oracle_fusion_financials_list_payables_invoices': {
      const input = oracleFusionListInvoicesInputSchema.parse(rawInput)
      const payload = await requestOracleFusionJson(
        input,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices`,
          query: listQuery(input, ORACLE_FUSION_INVOICE_FIELDS, {
            effectiveDate: input.effectiveDate,
          }),
        },
        signal
      )
      return projectList(
        payload,
        oracleFusionInvoiceSchema,
        ORACLE_FUSION_INVOICE_FIELDS,
        (invoice) => ({
          invoiceUniqId: extractInvoiceUniqId(invoice, input.instanceUrl),
          ...projectFields(invoice, ORACLE_FUSION_INVOICE_FIELDS),
        })
      )
    }
    case 'oracle_fusion_financials_get_payables_invoice': {
      const input = oracleFusionGetInvoiceInputSchema.parse(rawInput)
      const rawPayload = await requestOracleFusionJson(
        input,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices/${encodeURIComponent(input.invoiceUniqId)}`,
          query: detailQuery(ORACLE_FUSION_INVOICE_FIELDS),
        },
        signal
      )
      return requireProviderResponse(() => {
        const payload = oracleFusionInvoiceSchema.parse(rawPayload)
        const returnedKey = extractInvoiceUniqId(payload, input.instanceUrl)
        if (returnedKey !== input.invoiceUniqId) {
          throw new Error('Oracle invoice response self link does not match the requested key')
        }
        return {
          success: true,
          output: {
            invoice: {
              invoiceUniqId: returnedKey,
              ...projectFields(payload, ORACLE_FUSION_INVOICE_FIELDS),
            },
          },
        }
      })
    }
    case 'oracle_fusion_financials_list_payables_invoice_lines': {
      const input = oracleFusionInvoiceChildListInputSchema.parse(rawInput)
      const payload = await requestOracleFusionJson(
        input,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices/${encodeURIComponent(input.invoiceUniqId)}/child/invoiceLines`,
          query: listQuery(input, ORACLE_FUSION_INVOICE_LINE_FIELDS),
        },
        signal
      )
      return projectList(payload, oracleFusionInvoiceLineSchema, ORACLE_FUSION_INVOICE_LINE_FIELDS)
    }
    case 'oracle_fusion_financials_list_payables_invoice_installments': {
      const input = oracleFusionInvoiceChildListInputSchema.parse(rawInput)
      const payload = await requestOracleFusionJson(
        input,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices/${encodeURIComponent(input.invoiceUniqId)}/child/invoiceInstallments`,
          query: listQuery(input, ORACLE_FUSION_INSTALLMENT_FIELDS),
        },
        signal
      )
      return projectList(payload, oracleFusionInstallmentSchema, ORACLE_FUSION_INSTALLMENT_FIELDS)
    }
    case 'oracle_fusion_financials_list_payables_payments': {
      const input = oracleFusionListPaymentsInputSchema.parse(rawInput)
      const payload = await requestOracleFusionJson(
        input,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/payablesPayments`,
          query: listQuery(input, ORACLE_FUSION_PAYMENT_FIELDS),
        },
        signal
      )
      return projectList(payload, oracleFusionPaymentSchema, ORACLE_FUSION_PAYMENT_FIELDS)
    }
    case 'oracle_fusion_financials_get_payables_payment': {
      const input = oracleFusionGetPaymentInputSchema.parse(rawInput)
      const rawPayload = await requestOracleFusionJson(
        input,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/payablesPayments/${input.checkId}`,
          query: detailQuery(ORACLE_FUSION_PAYMENT_FIELDS),
        },
        signal
      )
      return requireProviderResponse(() => {
        const payload = oracleFusionPaymentSchema.parse(rawPayload)
        return {
          success: true,
          output: { payment: projectFields(payload, ORACLE_FUSION_PAYMENT_FIELDS) },
        }
      })
    }
  }
}
