import { createLogger } from '@sim/logger'
import type {
  QuickBooksInvoiceResponse,
  QuickBooksSendInvoiceParams,
} from '@/tools/quickbooks/types'
import { INVOICE_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksSendInvoice')

export const quickbooksSendInvoiceTool: ToolConfig<
  QuickBooksSendInvoiceParams,
  QuickBooksInvoiceResponse
> = {
  id: 'quickbooks_send_invoice',
  name: 'QuickBooks Send Invoice',
  description: 'Email a QuickBooks invoice to a recipient',
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
    invoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice ID to send',
    },
    sendTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address override; defaults to BillEmail on the invoice',
    },
  },

  request: {
    url: (params) => {
      const path = `/invoice/${encodeURIComponent(params.invoiceId.trim())}/send`
      const base = `${buildCompanyUrl(params.realmId, path)}?minorversion=73`
      return params.sendTo ? `${base}&sendTo=${encodeURIComponent(params.sendTo)}` : base
    },
    method: 'POST',
    headers: (params) => ({
      ...quickbooksAuthHeaders(params.accessToken),
      'Content-Type': 'application/octet-stream',
    }),
    body: () => ({}),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks send invoice failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to send QuickBooks invoice')
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
    invoice: { type: 'object', description: 'Invoice after send', properties: INVOICE_OUTPUT },
    invoiceId: { type: 'string', description: 'Invoice ID' },
  },
}
