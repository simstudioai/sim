import { createLogger } from '@sim/logger'
import type {
  QuickBooksCreatePaymentParams,
  QuickBooksPaymentResponse,
} from '@/tools/quickbooks/types'
import { PAYMENT_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksCreatePayment')

export const quickbooksCreatePaymentTool: ToolConfig<
  QuickBooksCreatePaymentParams,
  QuickBooksPaymentResponse
> = {
  id: 'quickbooks_create_payment',
  name: 'QuickBooks Create Payment',
  description: 'Record a customer payment in QuickBooks Online',
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
      description: 'Customer ID making the payment',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Total payment amount',
    },
    invoiceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional invoice ID to apply the payment to',
    },
    paymentMethodId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID',
    },
    txnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD)',
    },
    paymentRefNum: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment reference number (e.g., check number)',
    },
  },

  request: {
    url: (params) => `${buildCompanyUrl(params.realmId, '/payment')}?minorversion=73`,
    method: 'POST',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
    body: (params) => {
      const amount = Number(params.amount)
      if (!Number.isFinite(amount)) {
        throw new Error('Payment amount must be a number')
      }
      const body: Record<string, unknown> = {
        CustomerRef: { value: params.customerId },
        TotalAmt: amount,
      }
      if (params.txnDate) body.TxnDate = params.txnDate
      if (params.paymentRefNum) body.PaymentRefNum = params.paymentRefNum
      if (params.paymentMethodId) {
        body.PaymentMethodRef = { value: params.paymentMethodId }
      }
      if (params.invoiceId) {
        body.Line = [
          {
            Amount: amount,
            LinkedTxn: [{ TxnId: params.invoiceId, TxnType: 'Invoice' }],
          },
        ]
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks create payment failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to create QuickBooks payment')
    }
    const payment = (data?.Payment ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        payment,
        paymentId: payment ? ((payment.Id as string) ?? null) : null,
      },
    }
  },

  outputs: {
    payment: { type: 'object', description: 'Created payment', properties: PAYMENT_OUTPUT },
    paymentId: { type: 'string', description: 'New payment ID' },
  },
}
