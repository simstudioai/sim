import QuickBooks from 'node-quickbooks'
import type { CreatePaymentParams, PaymentResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreatePaymentTool: ToolConfig<CreatePaymentParams, PaymentResponse> = {
  id: 'quickbooks_create_payment',
  name: 'QuickBooks Create Payment',
  description: 'Create a payment received from a customer in QuickBooks Online',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks company ID (realm ID)',
    },
    CustomerRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer reference: { value: "customerId" }',
    },
    TotalAmt: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Total amount of the payment',
    },
    TxnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD format). Defaults to today.',
    },
    Line: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of line items linking to specific invoices',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const payment: Record<string, any> = {
        CustomerRef: params.CustomerRef,
        TotalAmt: params.TotalAmt,
      }

      if (params.TxnDate) payment.TxnDate = params.TxnDate
      if (params.Line) payment.Line = params.Line

      const createdPayment = await new Promise<any>((resolve, reject) => {
        qbo.createPayment(payment, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          payment: createdPayment,
          metadata: {
            Id: createdPayment.Id,
            TotalAmt: createdPayment.TotalAmt,
            TxnDate: createdPayment.TxnDate,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_CREATE_PAYMENT_ERROR',
          message: error.message || 'Failed to create payment',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment: {
      type: 'json',
      description: 'The created QuickBooks payment object',
    },
    metadata: {
      type: 'json',
      description: 'Payment summary metadata',
    },
  },
}
