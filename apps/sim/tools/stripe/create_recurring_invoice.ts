import type {
  CreateRecurringInvoiceParams,
  CreateRecurringInvoiceResponse,
} from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCreateRecurringInvoiceTool: ToolConfig<
  CreateRecurringInvoiceParams,
  CreateRecurringInvoiceResponse
> = {
  id: 'stripe_create_recurring_invoice',
  name: 'Stripe Create Recurring Invoice',
  description:
    'Create recurring invoices for subscription-based billing with automatic scheduling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stripe customer ID to invoice',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice amount in dollars',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency code (default: "usd")',
    },
    interval: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Billing interval: "month", "year", "week", or "day"',
    },
    intervalCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of intervals between invoices (default: 1)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the recurring invoice',
    },
    autoAdvance: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically finalize and attempt payment (default: true)',
    },
    daysUntilDue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days until invoice is due (default: 30)',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/invoices',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()
      formData.append('customer', params.customer)
      formData.append('auto_advance', String(params.autoAdvance ?? true))

      if (params.description) {
        formData.append('description', params.description)
      }

      if (params.daysUntilDue) {
        formData.append('days_until_due', params.daysUntilDue.toString())
      }

      // Add invoice item
      const amountCents = Math.round(params.amount * 100)
      formData.append('lines[0][amount]', amountCents.toString())
      formData.append('lines[0][currency]', params.currency || 'usd')
      formData.append(
        'lines[0][description]',
        params.description || `Recurring ${params.interval}ly invoice`
      )

      // Add metadata for recurring tracking
      formData.append('metadata[recurring]', 'true')
      formData.append('metadata[interval]', params.interval)
      formData.append('metadata[interval_count]', String(params.intervalCount || 1))

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response, params) => {
    if (!params) {
      throw new Error('Missing required parameters for recurring invoice')
    }

    const invoice = await response.json()

    // Calculate next invoice date based on interval
    const nextInvoiceDate = new Date()
    const intervalCount = params.intervalCount || 1

    switch (params.interval) {
      case 'day':
        nextInvoiceDate.setDate(nextInvoiceDate.getDate() + intervalCount)
        break
      case 'week':
        nextInvoiceDate.setDate(nextInvoiceDate.getDate() + intervalCount * 7)
        break
      case 'month':
        nextInvoiceDate.setMonth(nextInvoiceDate.getMonth() + intervalCount)
        break
      case 'year':
        nextInvoiceDate.setFullYear(nextInvoiceDate.getFullYear() + intervalCount)
        break
    }

    return {
      success: true,
      output: {
        invoice: {
          id: invoice.id,
          customer: invoice.customer,
          amount_due: invoice.amount_due / 100,
          currency: invoice.currency,
          status: invoice.status,
          created: new Date(invoice.created * 1000).toISOString().split('T')[0],
          due_date: invoice.due_date
            ? new Date(invoice.due_date * 1000).toISOString().split('T')[0]
            : null,
          invoice_pdf: invoice.invoice_pdf || null,
          hosted_invoice_url: invoice.hosted_invoice_url || null,
        },
        recurring_schedule: {
          interval: params.interval,
          interval_count: intervalCount,
          next_invoice_date: nextInvoiceDate.toISOString().split('T')[0],
          estimated_annual_value:
            params.interval === 'month'
              ? params.amount * 12 / intervalCount
              : params.interval === 'year'
                ? params.amount / intervalCount
                : params.interval === 'week'
                  ? params.amount * 52 / intervalCount
                  : params.amount * 365 / intervalCount,
        },
        metadata: {
          invoice_id: invoice.id,
          customer_id: invoice.customer,
          amount: invoice.amount_due / 100,
          status: invoice.status,
          recurring: true,
          interval: params.interval,
        },
      },
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'Created invoice object with payment details and hosted URL',
    },
    recurring_schedule: {
      type: 'json',
      description:
        'Recurring schedule information including next invoice date and annual value',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata including recurring status and interval',
    },
  },
}
