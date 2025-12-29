import { Client } from '@freshbooks/api'
import type { RecordPaymentParams, RecordPaymentResponse } from '@/tools/freshbooks/types'
import type { ToolConfig } from '@/tools/types'

/**
 * FreshBooks Record Payment Tool
 * Uses official @freshbooks/api SDK for payment processing
 */
export const freshbooksRecordPaymentTool: ToolConfig<
  RecordPaymentParams,
  RecordPaymentResponse
> = {
  id: 'freshbooks_record_payment',
  name: 'FreshBooks Record Payment',
  description: 'Record invoice payments and automatically update invoice status',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FreshBooks OAuth access token',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'FreshBooks account ID',
    },
    invoiceId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice ID to record payment against',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payment amount in dollars',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment date (YYYY-MM-DD, default: today)',
    },
    paymentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Payment method (e.g., "Check", "Credit Card", "Cash", "Bank Transfer", default: "Other")',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment notes or reference number',
    },
  },

  /**
   * SDK-based execution using @freshbooks/api Client
   * Records payment and fetches updated invoice status
   */
  directExecution: async (params) => {
    try {
      // Initialize FreshBooks SDK client
      const client = new Client(params.apiKey, {
        apiUrl: 'https://api.freshbooks.com',
      })

      // Prepare payment data
      const paymentData = {
        invoiceId: params.invoiceId,
        amount: {
          amount: params.amount.toString(),
          code: 'USD',
        },
        date: params.date || new Date().toISOString().split('T')[0],
        type: params.paymentType || 'Other',
        note: params.note || '',
      }

      // Record payment using SDK
      const paymentResponse = await client.payments.create(params.accountId, paymentData)
      
      if (!paymentResponse.data) {
        throw new Error('FreshBooks API returned no payment data')
      }
      
      const payment = paymentResponse.data

      // Fetch updated invoice to get current status
      const invoiceResponse = await client.invoices.single(
        params.accountId,
        String(params.invoiceId)
      )

      if (!invoiceResponse.data) {
        throw new Error('FreshBooks API returned no invoice data')
      }

      const invoice = invoiceResponse.data

      // Parse amounts
      const totalAmount = parseFloat(invoice.amount?.amount || '0')
      const paidAmount = parseFloat(invoice.paid?.amount || '0')
      const outstandingAmount = parseFloat(invoice.outstanding?.amount || '0')

      return {
        success: true,
        output: {
          payment: {
            id: payment.id,
            invoice_id: params.invoiceId,
            amount: params.amount,
            currency: 'USD',
            date: paymentData.date,
            type: paymentData.type,
            note: params.note,
          },
          invoice_status: {
            id: invoice.id,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            outstanding_amount: outstandingAmount,
            status: invoice.status || 'partial',
          },
          metadata: {
            payment_id: payment.id,
            invoice_id: params.invoiceId,
            amount_paid: params.amount,
            payment_date: paymentData.date,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `FRESHBOOKS_PAYMENT_ERROR: Failed to record payment in FreshBooks - ${errorDetails}`,
      }
    }
  },

  outputs: {
    payment: {
      type: 'json',
      description: 'Recorded payment details',
    },
    invoice_status: {
      type: 'json',
      description: 'Updated invoice status with amounts and payment status',
    },
    metadata: {
      type: 'json',
      description: 'Payment metadata for tracking',
    },
  },
}
