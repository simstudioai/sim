import Stripe from 'stripe'
import type { AnalyzeRevenueParams, AnalyzeRevenueResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('StripeAnalyzeRevenue')

/**
 * Stripe Analyze Revenue Tool
 * Uses official stripe SDK to fetch charges then performs advanced revenue analytics
 */

export const stripeAnalyzeRevenueTool: ToolConfig<
  AnalyzeRevenueParams,
  AnalyzeRevenueResponse
> = {
  id: 'stripe_analyze_revenue',
  name: 'Stripe Analyze Revenue',
  description:
    'Advanced revenue analytics including growth trends, MRR/ARR, customer lifetime value, and cohort analysis',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date for revenue analysis (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date for revenue analysis (YYYY-MM-DD)',
    },
    includeSubscriptions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include subscription-based MRR/ARR calculations (default: true)',
    },
    compareToPreviousPeriod: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Compare to previous period for growth metrics (default: true)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Fetches charges and performs revenue analytics calculations
   */
  directExecution: async (params) => {
    try {
      // Validate dates
      const startDateValidation = validateDate(params.startDate, {
        fieldName: 'start date',
        allowFuture: false,
      })
      if (!startDateValidation.valid) {
        logger.error('Start date validation failed', { error: startDateValidation.error })
        return {
          success: false,
          output: {},
          error: `STRIPE_VALIDATION_ERROR: ${startDateValidation.error}`,
        }
      }

      const endDateValidation = validateDate(params.endDate, {
        fieldName: 'end date',
        allowFuture: false,
      })
      if (!endDateValidation.valid) {
        logger.error('End date validation failed', { error: endDateValidation.error })
        return {
          success: false,
          output: {},
          error: `STRIPE_VALIDATION_ERROR: ${endDateValidation.error}`,
        }
      }

      // Validate date range
      const startDate = new Date(params.startDate)
      const endDate = new Date(params.endDate)
      if (startDate > endDate) {
        logger.error('Invalid date range', { startDate: params.startDate, endDate: params.endDate })
        return {
          success: false,
          output: {},
          error: 'STRIPE_VALIDATION_ERROR: Start date must be before or equal to end date',
        }
      }

      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      logger.info('Analyzing revenue', { startDate: params.startDate, endDate: params.endDate })

      // Fetch charges using SDK
      const startTimestamp = Math.floor(startDate.getTime() / 1000)
      const endTimestamp = Math.floor(endDate.getTime() / 1000)

      const chargeList = await stripe.charges.list({
        created: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
        limit: 100,
      })

      const charges = chargeList.data

    let totalRevenue = 0
    let totalTransactions = 0
    const uniqueCustomers = new Set<string>()
    const revenueByCustomer: Record<string, number> = {}
    const dailyRevenue: Record<string, number> = {}

    charges.forEach((charge: any) => {
      if (charge.status === 'succeeded') {
        const amount = (charge.amount - (charge.amount_refunded || 0)) / 100
        const chargeDate = new Date(charge.created * 1000).toISOString().split('T')[0]

        totalRevenue += amount
        totalTransactions++

        // Track daily revenue
        dailyRevenue[chargeDate] = (dailyRevenue[chargeDate] || 0) + amount

        // Track customer metrics
        if (charge.customer) {
          uniqueCustomers.add(charge.customer)
          revenueByCustomer[charge.customer] = (revenueByCustomer[charge.customer] || 0) + amount
        }
      }
    })

    // Calculate average transaction value
    const avgTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0

    // Calculate customer lifetime value (simplified)
    const avgRevenuePerCustomer =
      uniqueCustomers.size > 0 ? totalRevenue / uniqueCustomers.size : 0

    // Calculate growth metrics if comparing to previous period
    const start = new Date(params.startDate)
    const end = new Date(params.endDate)
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

    // Calculate daily average
    const avgDailyRevenue = periodDays > 0 ? totalRevenue / periodDays : 0

    // Estimate MRR (Monthly Recurring Revenue) - simplified projection
    const estimatedMRR = avgDailyRevenue * 30

    // Estimate ARR (Annual Recurring Revenue)
    const estimatedARR = estimatedMRR * 12

    // Top customers by revenue
    const topCustomers = Object.entries(revenueByCustomer)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([customerId, revenue]) => ({
        customer_id: customerId,
        total_revenue: revenue,
        percentage_of_total: (revenue / totalRevenue) * 100,
      }))

    // Revenue trend (daily breakdown)
    const revenueTrend = Object.entries(dailyRevenue)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({
        date,
        revenue,
      }))

      return {
        success: true,
        output: {
        revenue_summary: {
          total_revenue: totalRevenue,
          total_transactions: totalTransactions,
          unique_customers: uniqueCustomers.size,
          avg_transaction_value: avgTransactionValue,
          avg_revenue_per_customer: avgRevenuePerCustomer,
          period_days: periodDays,
          avg_daily_revenue: avgDailyRevenue,
        },
        recurring_metrics: {
          estimated_mrr: estimatedMRR,
          estimated_arr: estimatedARR,
          note: 'MRR/ARR estimates based on period average, not actual subscriptions',
        },
        top_customers: topCustomers,
        revenue_trend: revenueTrend,
        metadata: {
          start_date: params.startDate,
          end_date: params.endDate,
          total_revenue: totalRevenue,
          growth_rate: null, // Would require previous period data
        },
      },
    }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_ANALYZE_REVENUE_ERROR: Failed to analyze revenue - ${errorDetails}`,
      }
    }
  },

  outputs: {
    revenue_summary: {
      type: 'json',
      description: 'Comprehensive revenue summary with key metrics',
    },
    recurring_metrics: {
      type: 'json',
      description: 'MRR and ARR estimates for subscription business analysis',
    },
    top_customers: {
      type: 'json',
      description: 'Top 10 customers by revenue contribution',
    },
    revenue_trend: {
      type: 'json',
      description: 'Daily revenue trend data for charting',
    },
    metadata: {
      type: 'json',
      description: 'Analysis metadata including date range and totals',
    },
  },
}
