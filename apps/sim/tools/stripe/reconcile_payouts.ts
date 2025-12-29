import Stripe from 'stripe'
import type { ReconcilePayoutsParams, ReconcilePayoutsResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('StripeReconcilePayouts')

/**
 * Stripe Reconcile Payouts Tool
 * Uses official stripe SDK to fetch payouts then matches to bank transactions
 */

export const stripeReconcilePayoutsTool: ToolConfig<
  ReconcilePayoutsParams,
  ReconcilePayoutsResponse
> = {
  id: 'stripe_reconcile_payouts',
  name: 'Stripe Reconcile Payouts',
  description:
    'Match Stripe payouts to bank deposits for automated reconciliation with confidence scoring',
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
      description: 'Start date for payout reconciliation (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date for payout reconciliation (YYYY-MM-DD)',
    },
    bankTransactions: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of bank transactions from Plaid to match against Stripe payouts',
    },
    amountTolerance: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount tolerance for matching (default: 0.01 = $0.01)',
    },
    dateTolerance: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days tolerance for matching dates (default: 2)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Fetches payouts and matches them to bank transactions
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

      logger.info('Reconciling payouts', { startDate: params.startDate, endDate: params.endDate })

      // Fetch payouts using SDK
      const startTimestamp = Math.floor(startDate.getTime() / 1000)
      const endTimestamp = Math.floor(endDate.getTime() / 1000)

      const payoutList = await stripe.payouts.list({
        created: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
        limit: 100,
      })

      const payouts = payoutList.data
      const bankTransactions = (params.bankTransactions as any[]) || []
      const amountTolerance = params.amountTolerance || 0.01
      const dateTolerance = params.dateTolerance || 2

    const matchedPayouts: any[] = []
    const unmatchedPayouts: any[] = []

    payouts.forEach((payout: any) => {
      const payoutAmount = payout.amount / 100 // Convert cents to dollars
      const payoutDate = new Date(payout.created * 1000)

      // Find matching bank transaction
      const match = bankTransactions.find((tx: any) => {
        const txAmount = Math.abs(tx.amount)
        const txDate = new Date(tx.date)
        const daysDiff = Math.abs(
          (txDate.getTime() - payoutDate.getTime()) / (1000 * 60 * 60 * 24)
        )

        return Math.abs(txAmount - payoutAmount) <= amountTolerance && daysDiff <= dateTolerance
      })

      if (match) {
        const confidence =
          Math.abs(match.amount - payoutAmount) < 0.01 &&
          Math.abs(
            (new Date(match.date).getTime() - payoutDate.getTime()) / (1000 * 60 * 60 * 24)
          ) < 1
            ? 0.95
            : 0.85

        matchedPayouts.push({
          payout_id: payout.id,
          payout_amount: payoutAmount,
          payout_date: payoutDate.toISOString().split('T')[0],
          payout_status: payout.status,
          bank_transaction_id: match.transaction_id,
          bank_amount: match.amount,
          bank_date: match.date,
          bank_name: match.name,
          confidence,
          status: 'matched',
        })
      } else {
        unmatchedPayouts.push({
          payout_id: payout.id,
          payout_amount: payoutAmount,
          payout_date: payoutDate.toISOString().split('T')[0],
          payout_status: payout.status,
          arrival_date: payout.arrival_date
            ? new Date(payout.arrival_date * 1000).toISOString().split('T')[0]
            : null,
          status: 'unmatched',
          reason: 'No matching bank transaction found within tolerance',
        })
      }
    })

      return {
        success: true,
        output: {
        matched_payouts: matchedPayouts,
        unmatched_payouts: unmatchedPayouts,
        metadata: {
          total_payouts: payouts.length,
          matched_count: matchedPayouts.length,
          unmatched_count: unmatchedPayouts.length,
          match_rate: payouts.length > 0 ? matchedPayouts.length / payouts.length : 0,
          date_range: {
            start: params.startDate,
            end: params.endDate,
          },
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
        error: `STRIPE_RECONCILE_PAYOUTS_ERROR: Failed to reconcile payouts - ${errorDetails}`,
      }
    }
  },

  outputs: {
    matched_payouts: {
      type: 'json',
      description: 'Array of successfully matched Stripe payouts to bank transactions',
    },
    unmatched_payouts: {
      type: 'json',
      description: 'Array of Stripe payouts that could not be matched to bank deposits',
    },
    metadata: {
      type: 'json',
      description: 'Reconciliation metadata including match rate and counts',
    },
  },
}
