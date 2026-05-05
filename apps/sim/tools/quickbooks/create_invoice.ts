import { createLogger } from '@sim/logger'
import type {
  QuickBooksCreateInvoiceParams,
  QuickBooksInvoiceResponse,
  QuickBooksLineItem,
} from '@/tools/quickbooks/types'
import { INVOICE_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksCreateInvoice')

function coerceLines(input: QuickBooksCreateInvoiceParams['lines']): QuickBooksLineItem[] {
  if (Array.isArray(input)) return input
  if (typeof input !== 'string') {
    throw new Error('Invoice lines must be a JSON array')
  }
  const parsed = JSON.parse(input)
  if (!Array.isArray(parsed)) {
    throw new Error('Invoice lines must be a JSON array')
  }
  return parsed as QuickBooksLineItem[]
}

export const quickbooksCreateInvoiceTool: ToolConfig<
  QuickBooksCreateInvoiceParams,
  QuickBooksInvoiceResponse
> = {
  id: 'quickbooks_create_invoice',
  name: 'QuickBooks Create Invoice',
  description: 'Create a new invoice in QuickBooks Online',
  version: '1.0.0',

  oauth: { required: true, provider: 'quickbooks' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID (realmId) — captured at OAuth time',
    },
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to bill',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Invoice line items (JSON array). Each entry: { description?, amount, quantity?, itemId?, itemName? }',
    },
    txnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD)',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (YYYY-MM-DD)',
    },
    customerMemo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Memo shown to the customer on the invoice',
    },
    billEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to bill (used by Send Invoice flows)',
    },
  },

  request: {
    url: (params) => `${buildCompanyUrl(params.realmId, '/invoice')}?minorversion=73`,
    method: 'POST',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
    body: (params) => {
      const lines = coerceLines(params.lines)
      if (lines.length === 0) {
        throw new Error('At least one invoice line is required')
      }

      const Line = lines.map((line) => {
        const amount = Number(line.amount)
        if (!Number.isFinite(amount)) {
          throw new Error('Each invoice line requires a numeric `amount`')
        }
        if (!line.itemId) {
          throw new Error('Each invoice line requires `itemId`')
        }
        const itemRef = {
          value: line.itemId,
          ...(line.itemName ? { name: line.itemName } : {}),
        }
        const salesItemLineDetail: Record<string, unknown> = { ItemRef: itemRef }
        if (line.quantity !== undefined) salesItemLineDetail.Qty = Number(line.quantity)

        return {
          DetailType: 'SalesItemLineDetail',
          Amount: amount,
          ...(line.description ? { Description: line.description } : {}),
          SalesItemLineDetail: salesItemLineDetail,
        }
      })

      const body: Record<string, unknown> = {
        CustomerRef: { value: params.customerId },
        Line,
      }
      if (params.txnDate) body.TxnDate = params.txnDate
      if (params.dueDate) body.DueDate = params.dueDate
      if (params.customerMemo) body.CustomerMemo = { value: params.customerMemo }
      if (params.billEmail) body.BillEmail = { Address: params.billEmail }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks create invoice failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to create QuickBooks invoice')
    }
    const invoice = (data?.Invoice ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        invoice,
        invoiceId: invoice ? ((invoice.Id as string) ?? null) : null,
      },
    }
  },

  outputs: {
    invoice: { type: 'object', description: 'Created invoice', properties: INVOICE_OUTPUT },
    invoiceId: { type: 'string', description: 'New invoice ID' },
  },
}
