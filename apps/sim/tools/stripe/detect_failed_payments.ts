import Stripe from 'stripe'
import type {
  DetectFailedPaymentsParams,
  DetectFailedPaymentsResponse,
} from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('StripeDetectFailedPayments')

/**
 * Stripe Detect Failed Payments Tool
 * Uses official stripe SDK to fetch failed charges then performs failure analysis
 */

export const stripeDetectFailedPaymentsTool: ToolConfig<
  DetectFailedPaymentsParams,
  DetectFailedPaymentsResponse
> = {
  id: 'stripe_detect_failed_payments',
  name: 'Stripe Detect Failed Payments',
  description:
    'Monitor and analyze payment failures with categorization, customer impact analysis, and recovery recommendations',
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
      description: 'Start date for failure analysis (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date for failure analysis (YYYY-MM-DD)',
    },
    minimumAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include failures above this amount (default: 0)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Fetches failed charges and performs failure analysis
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

      logger.info('Detecting failed payments', { startDate: params.startDate, endDate: params.endDate })

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
      const minimumAmount = params.minimumAmount || 0

    const failedPayments: any[] = []
    const failureReasons: Record<string, number> = {}
    const failuresByCustomer: Record<string, number> = {}
    let totalFailedAmount = 0

    charges.forEach((charge: any) => {
      if (charge.status === 'failed') {
        const amount = charge.amount / 100

        if (amount >= minimumAmount) {
          const failureCode = charge.failure_code || 'unknown'
          const failureMessage = charge.failure_message || 'Unknown error'
          const customerId = charge.customer || 'guest'

          failedPayments.push({
            charge_id: charge.id,
            customer_id: customerId,
            amount,
            currency: charge.currency,
            failure_code: failureCode,
            failure_message: failureMessage,
            created: new Date(charge.created * 1000).toISOString().split('T')[0],
            payment_method: charge.payment_method_details?.type || 'unknown',
            description: charge.description || null,
            receipt_email: charge.receipt_email || null,
          })

          // Track failure reasons
          failureReasons[failureCode] = (failureReasons[failureCode] || 0) + 1

          // Track failures by customer
          failuresByCustomer[customerId] = (failuresByCustomer[customerId] || 0) + 1

          totalFailedAmount += amount
        }
      }
    })

    // Categorize failures
    const categorizedFailures = {
      insufficient_funds: 0,
      card_declined: 0,
      expired_card: 0,
      incorrect_cvc: 0,
      processing_error: 0,
      fraud_suspected: 0,
      other: 0,
    }

    Object.entries(failureReasons).forEach(([code, count]) => {
      if (code.includes('insufficient') || code === 'card_declined') {
        categorizedFailures.insufficient_funds += count
      } else if (code.includes('declined')) {
        categorizedFailures.card_declined += count
      } else if (code.includes('expired')) {
        categorizedFailures.expired_card += count
      } else if (code.includes('cvc') || code.includes('cvv')) {
        categorizedFailures.incorrect_cvc += count
      } else if (code.includes('processing')) {
        categorizedFailures.processing_error += count
      } else if (code.includes('fraud') || code.includes('risk')) {
        categorizedFailures.fraud_suspected += count
      } else {
        categorizedFailures.other += count
      }
    })

    // High-risk customers (multiple failures)
    const highRiskCustomers = Object.entries(failuresByCustomer)
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .map(([customerId, failureCount]) => ({
        customer_id: customerId,
        failure_count: failureCount,
        risk_level: failureCount >= 3 ? 'high' : 'medium',
        recommended_action:
          failureCount >= 3
            ? 'Contact customer immediately - multiple payment failures'
            : 'Monitor for additional failures',
      }))

    // Recovery recommendations
    const recommendations: string[] = []
    if (categorizedFailures.insufficient_funds > 0) {
      recommendations.push(
        'Contact customers with insufficient funds - offer payment plans or alternative payment methods'
      )
    }
    if (categorizedFailures.expired_card > 0) {
      recommendations.push(
        'Send automated emails requesting card updates for expired cards'
      )
    }
    if (categorizedFailures.fraud_suspected > 0) {
      recommendations.push(
        'Review fraud-flagged transactions - may need manual verification'
      )
    }
    if (highRiskCustomers.length > 0) {
      recommendations.push(
        `${highRiskCustomers.length} customers have multiple failures - prioritize outreach`
      )
    }

      return {
        success: true,
        output: {
        failed_payments: failedPayments,
        failure_summary: {
          total_failures: failedPayments.length,
          total_failed_amount: totalFailedAmount,
          unique_customers_affected: Object.keys(failuresByCustomer).length,
          avg_failed_amount:
            failedPayments.length > 0 ? totalFailedAmount / failedPayments.length : 0,
        },
        failure_categories: categorizedFailures,
        failure_reasons: Object.entries(failureReasons)
          .sort(([, a], [, b]) => b - a)
          .map(([code, count]) => ({
            failure_code: code,
            count,
            percentage: (count / failedPayments.length) * 100,
          })),
        high_risk_customers: highRiskCustomers,
        recovery_recommendations: recommendations,
        metadata: {
          start_date: params.startDate,
          end_date: params.endDate,
          total_failures: failedPayments.length,
          total_failed_amount: totalFailedAmount,
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
        error: `STRIPE_DETECT_FAILED_PAYMENTS_ERROR: Failed to detect failed payments - ${errorDetails}`,
      }
    }
  },

  outputs: {
    failed_payments: {
      type: 'json',
      description: 'Detailed list of all failed payment attempts',
    },
    failure_summary: {
      type: 'json',
      description: 'Summary of failure metrics including total amount and customer count',
    },
    failure_categories: {
      type: 'json',
      description: 'Categorized breakdown of failure types',
    },
    failure_reasons: {
      type: 'json',
      description: 'Detailed failure reasons with counts and percentages',
    },
    high_risk_customers: {
      type: 'json',
      description: 'Customers with multiple payment failures requiring attention',
    },
    recovery_recommendations: {
      type: 'json',
      description: 'Actionable recommendations for recovering failed payments',
    },
    metadata: {
      type: 'json',
      description: 'Analysis metadata including date range and totals',
    },
  },
}
