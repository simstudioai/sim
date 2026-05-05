import { createLogger } from '@sim/logger'
import type {
  QuickBooksBillLine,
  QuickBooksBillResponse,
  QuickBooksCreateBillParams,
} from '@/tools/quickbooks/types'
import { BILL_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, coerceJsonArray, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksCreateBill')

const coerceLines = (input: QuickBooksCreateBillParams['lines']): QuickBooksBillLine[] =>
  coerceJsonArray<QuickBooksBillLine>(input, 'Bill lines')

export const quickbooksCreateBillTool: ToolConfig<
  QuickBooksCreateBillParams,
  QuickBooksBillResponse
> = {
  id: 'quickbooks_create_bill',
  name: 'QuickBooks Create Bill',
  description: 'Create a new bill (vendor expense) in QuickBooks Online',
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
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor ID for the bill',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bill line items (JSON array). Each entry: { amount, accountId, description? }',
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
  },

  request: {
    url: (params) => `${buildCompanyUrl(params.realmId, '/bill')}?minorversion=73`,
    method: 'POST',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
    body: (params) => {
      const lines = coerceLines(params.lines)
      if (lines.length === 0) {
        throw new Error('At least one bill line is required')
      }

      const Line = lines.map((line) => {
        const amount = Number(line.amount)
        if (!Number.isFinite(amount)) {
          throw new Error('Each bill line requires a numeric `amount`')
        }
        if (!line.accountId) {
          throw new Error('Each bill line requires an `accountId`')
        }
        const entry: Record<string, unknown> = {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: amount,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: line.accountId },
          },
        }
        if (line.description) entry.Description = line.description
        return entry
      })

      const body: Record<string, unknown> = {
        VendorRef: { value: params.vendorId },
        Line,
      }
      if (params.txnDate) body.TxnDate = params.txnDate
      if (params.dueDate) body.DueDate = params.dueDate
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks create bill failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to create QuickBooks bill')
    }
    const bill = (data?.Bill ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        bill,
        billId: bill ? ((bill.Id as string) ?? null) : null,
      },
    }
  },

  outputs: {
    bill: { type: 'object', description: 'Created bill', properties: BILL_OUTPUT },
    billId: { type: 'string', description: 'New bill ID' },
  },
}
