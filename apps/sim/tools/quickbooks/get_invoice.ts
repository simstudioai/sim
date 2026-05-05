import { createLogger } from '@sim/logger'
import type {
  QuickBooksGetInvoiceParams,
  QuickBooksInvoiceResponse,
} from '@/tools/quickbooks/types'
import { INVOICE_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksGetInvoice')

export const quickbooksGetInvoiceTool: ToolConfig<
  QuickBooksGetInvoiceParams,
  QuickBooksInvoiceResponse
> = {
  id: 'quickbooks_get_invoice',
  name: 'QuickBooks Get Invoice',
  description: 'Retrieve a single QuickBooks invoice by ID',
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
      description: 'QuickBooks invoice ID',
    },
  },

  request: {
    url: (params) =>
      `${buildCompanyUrl(params.realmId, `/invoice/${encodeURIComponent(params.invoiceId.trim())}`)}?minorversion=73`,
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks get invoice failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to get QuickBooks invoice')
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
    invoice: { type: 'object', description: 'Invoice record', properties: INVOICE_OUTPUT },
    invoiceId: { type: 'string', description: 'Invoice ID' },
  },
}
