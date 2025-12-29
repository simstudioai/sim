import Stripe from 'stripe'
import type { GenerateTaxReportParams, GenerateTaxReportResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Generate Tax Report Tool
 * Uses official stripe SDK to fetch charges then generates 1099-K tax reports
 */

export const stripeGenerateTaxReportTool: ToolConfig<
  GenerateTaxReportParams,
  GenerateTaxReportResponse
> = {
  id: 'stripe_generate_tax_report',
  name: 'Stripe Generate Tax Report',
  description: 'Generate 1099-K tax documentation and payment volume reports for tax filing',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    taxYear: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tax year for report (e.g., 2024)',
    },
    reportType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of tax report: "1099-K" or "full" (default: "1099-K")',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Fetches charges for tax year and generates 1099-K report
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Fetch charges for tax year using SDK
      const startDate = new Date(`${params.taxYear}-01-01`)
      const endDate = new Date(`${params.taxYear}-12-31`)
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

      const reportType = params.reportType || '1099-K'

    let totalGrossPayments = 0
    let totalRefunds = 0
    let totalNetPayments = 0
    let transactionCount = 0
    const monthlyBreakdown: any[] = []
    const paymentMethodBreakdown: Record<string, number> = {}

    // Initialize monthly breakdown
    for (let month = 1; month <= 12; month++) {
      monthlyBreakdown.push({
        month,
        month_name: new Date(params.taxYear, month - 1).toLocaleString('default', {
          month: 'long',
        }),
        gross_payments: 0,
        refunds: 0,
        net_payments: 0,
        transaction_count: 0,
      })
    }

    charges.forEach((charge: any) => {
      if (charge.status === 'succeeded') {
        const amount = charge.amount / 100
        const chargeDate = new Date(charge.created * 1000)
        const month = chargeDate.getMonth()

        totalGrossPayments += amount
        transactionCount++
        monthlyBreakdown[month].gross_payments += amount
        monthlyBreakdown[month].transaction_count++

        // Track payment methods
        const paymentMethod = charge.payment_method_details?.type || 'unknown'
        paymentMethodBreakdown[paymentMethod] =
          (paymentMethodBreakdown[paymentMethod] || 0) + amount

        // Track refunds
        if (charge.amount_refunded > 0) {
          const refundAmount = charge.amount_refunded / 100
          totalRefunds += refundAmount
          monthlyBreakdown[month].refunds += refundAmount
        }
      }
    })

    totalNetPayments = totalGrossPayments - totalRefunds

    // Calculate net for each month
    monthlyBreakdown.forEach((month) => {
      month.net_payments = month.gross_payments - month.refunds
    })

    // Determine 1099-K filing requirement (threshold is $600 for 2024+)
    const requires1099K = totalGrossPayments >= 600

      return {
        success: true,
        output: {
        tax_summary: {
          tax_year: params.taxYear,
          total_gross_payments: totalGrossPayments,
          total_refunds: totalRefunds,
          total_net_payments: totalNetPayments,
          total_transactions: transactionCount,
          requires_1099k: requires1099K,
          threshold_amount: 600,
          filing_deadline: `March 31, ${params.taxYear + 1}`,
        },
        monthly_breakdown: monthlyBreakdown,
        payment_method_breakdown: Object.entries(paymentMethodBreakdown).map(([type, amount]) => ({
          payment_type: type,
          total_amount: amount,
          percentage: (amount / totalGrossPayments) * 100,
        })),
        metadata: {
          tax_year: params.taxYear,
          report_type: reportType,
          requires_1099k: requires1099K,
          total_gross_payments: totalGrossPayments,
          total_net_payments: totalNetPayments,
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
        error: `STRIPE_GENERATE_TAX_REPORT_ERROR: Failed to generate tax report - ${errorDetails}`,
      }
    }
  },

  outputs: {
    tax_summary: {
      type: 'json',
      description: '1099-K tax summary including gross payments, refunds, and filing requirements',
    },
    monthly_breakdown: {
      type: 'json',
      description: 'Month-by-month payment breakdown for the tax year',
    },
    payment_method_breakdown: {
      type: 'json',
      description: 'Breakdown of payments by payment method type',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata including filing requirements',
    },
  },
}
