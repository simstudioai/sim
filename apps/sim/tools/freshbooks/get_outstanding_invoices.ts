import { Client } from '@freshbooks/api'
import { SearchQueryBuilder } from '@freshbooks/api/dist/models/builders'
import type {
  GetOutstandingInvoicesParams,
  GetOutstandingInvoicesResponse,
} from '@/tools/freshbooks/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@sim/logger'

const logger = createLogger('FreshBooksOutstandingInvoices')

/**
 * FreshBooks Get Outstanding Invoices Tool
 * Uses official @freshbooks/api SDK for accounts receivable analysis
 */
export const freshbooksGetOutstandingInvoicesTool: ToolConfig<
  GetOutstandingInvoicesParams,
  GetOutstandingInvoicesResponse
> = {
  id: 'freshbooks_get_outstanding_invoices',
  name: 'FreshBooks Get Outstanding Invoices',
  description:
    'Analyze unpaid invoices with aging analysis and collections prioritization',
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
    clientId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific client ID (optional)',
    },
    daysOverdue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only show invoices overdue by at least this many days (optional)',
    },
    minimumAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only show invoices with outstanding amount above this threshold (optional)',
    },
  },

  /**
   * SDK-based execution using @freshbooks/api SDK
   * Fetches unpaid/partial invoices and performs aging analysis
   */
  directExecution: async (params) => {
    try {
      // Initialize FreshBooks SDK client
      const client = new Client(params.apiKey, {
        apiUrl: 'https://api.freshbooks.com',
      })

      // Build search criteria for outstanding invoices
      const searchBuilder = new SearchQueryBuilder().in('status', ['unpaid', 'partial'])

      if (params.clientId) {
        searchBuilder.equals('customerid', params.clientId)
      }

      // Fetch invoices using SDK
      const response = await client.invoices.list(params.accountId, [searchBuilder])
      const invoices = response.data?.invoices || []

      const today = new Date()
      const outstandingInvoices: any[] = []
      const clientsSet = new Set<string>()
      let totalOutstanding = 0
      let totalDaysOverdue = 0

      // Aging buckets
      const aging = {
        current: 0,
        overdue_1_30_days: 0,
        overdue_31_60_days: 0,
        overdue_61_90_days: 0,
        overdue_over_90_days: 0,
      }

      const formatDate = (date: Date) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }

      invoices.forEach((invoice: any) => {
        const outstandingAmount = parseFloat(invoice.outstanding?.amount || '0')

        // Parse date string to Date object (FreshBooks returns ISO date strings)
        let dueDate: Date
        try {
          const dueDateStr = invoice.dueDate || invoice.due_date || invoice.createDate || invoice.create_date
          if (dueDateStr) {
            dueDate = new Date(dueDateStr)
            // Validate the date
            if (Number.isNaN(dueDate.getTime())) {
              logger.warn('Invalid due date for invoice', {
                invoiceId: invoice.id,
                dueDate: dueDateStr
              })
              dueDate = new Date() // Fallback to today
            }
          } else {
            logger.warn('No due date found for invoice', { invoiceId: invoice.id })
            dueDate = new Date() // Fallback to today
          }
        } catch (error) {
          logger.warn('Error parsing due date for invoice', {
            invoiceId: invoice.id,
            error
          })
          dueDate = new Date() // Fallback to today
        }

        const daysOverdue = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
        )

        // Apply filters
        if (params.minimumAmount && outstandingAmount < params.minimumAmount) {
          return
        }
        if (params.daysOverdue && daysOverdue < params.daysOverdue) {
          return
        }

        // Fetch client name (simplified - would normally cache this)
        const clientId = invoice.customerId
        const clientName = invoice.organization || `Client ${clientId ?? 'Unknown'}`
        if (clientId !== undefined && clientId !== null) {
          clientsSet.add(String(clientId))
        }

        outstandingInvoices.push({
          id: invoice.id,
          invoice_number: invoice.invoiceNumber || `INV-${invoice.id}`,
          client_name: clientName,
          amount_due: outstandingAmount,
          currency: invoice.currencyCode || 'USD',
          due_date: formatDate(dueDate),
          days_overdue: Math.max(0, daysOverdue),
          status: invoice.status,
        })

        totalOutstanding += outstandingAmount
        if (daysOverdue > 0) {
          totalDaysOverdue += daysOverdue
        }

        // Categorize into aging buckets
        if (daysOverdue <= 0) {
          aging.current += outstandingAmount
        } else if (daysOverdue <= 30) {
          aging.overdue_1_30_days += outstandingAmount
        } else if (daysOverdue <= 60) {
          aging.overdue_31_60_days += outstandingAmount
        } else if (daysOverdue <= 90) {
          aging.overdue_61_90_days += outstandingAmount
        } else {
          aging.overdue_over_90_days += outstandingAmount
        }
      })

      // Sort by days overdue (descending) for prioritization
      outstandingInvoices.sort((a, b) => b.days_overdue - a.days_overdue)

      return {
        success: true,
        output: {
          outstanding_invoices: outstandingInvoices,
          summary: {
            total_outstanding: totalOutstanding,
            total_invoices: outstandingInvoices.length,
            average_days_overdue:
              outstandingInvoices.length > 0 ? totalDaysOverdue / outstandingInvoices.length : 0,
            total_clients_affected: clientsSet.size,
          },
          aging_analysis: aging,
          metadata: {
            total_outstanding: totalOutstanding,
            invoice_count: outstandingInvoices.length,
            generated_at: new Date().toISOString().split('T')[0],
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message || 'Unknown error'
      logger.error('Failed to fetch outstanding invoices from FreshBooks', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `FRESHBOOKS_OUTSTANDING_INVOICES_ERROR: Failed to fetch outstanding invoices from FreshBooks - ${errorDetails}`,
      }
    }
  },

  outputs: {
    outstanding_invoices: {
      type: 'json',
      description: 'List of unpaid invoices sorted by days overdue',
    },
    summary: {
      type: 'json',
      description: 'Summary statistics for outstanding invoices',
    },
    aging_analysis: {
      type: 'json',
      description: 'Aging buckets showing receivables by overdue period',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata',
    },
  },
}
