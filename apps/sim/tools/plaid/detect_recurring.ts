import type { DetectRecurringParams, DetectRecurringResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

export const plaidDetectRecurringTool: ToolConfig<DetectRecurringParams, DetectRecurringResponse> =
  {
    id: 'plaid_detect_recurring',
    name: 'Plaid Detect Recurring Transactions',
    description:
      'Detect recurring transactions (subscriptions, monthly bills) from bank transaction history',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Plaid client ID',
      },
      apiSecret: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Plaid secret key',
      },
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Plaid access token for the item',
      },
      transactions: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of Plaid transactions to analyze (minimum 60 days recommended)',
      },
      minOccurrences: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Minimum number of occurrences to consider recurring (default: 2)',
      },
      toleranceDays: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Day tolerance for matching intervals (default: 3 days)',
      },
      amountTolerance: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Amount variance tolerance as percentage (default: 0.05 = 5%)',
      },
    },

    request: {
      url: () => 'https://production.plaid.com/transactions/recurring/get',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        return { body: JSON.stringify({}) }
      },
    },

    transformResponse: async (response, params) => {
      const transactions = params.transactions as any[]
      const minOccurrences = params.minOccurrences || 2
      const toleranceDays = params.toleranceDays || 3
      const amountTolerance = params.amountTolerance || 0.05

      const merchantGroups = new Map<string, any[]>()

      transactions.forEach((tx) => {
        const merchant = tx.merchant_name || tx.name || 'Unknown'
        if (!merchantGroups.has(merchant)) {
          merchantGroups.set(merchant, [])
        }
        merchantGroups.get(merchant)!.push(tx)
      })

      const recurringSubscriptions: any[] = []

      merchantGroups.forEach((txs, merchant) => {
        if (txs.length < minOccurrences) return

        txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

        const intervals: number[] = []
        for (let i = 1; i < txs.length; i++) {
          const daysDiff = Math.abs(
            (new Date(txs[i].date).getTime() - new Date(txs[i - 1].date).getTime()) /
              (1000 * 60 * 60 * 24)
          )
          intervals.push(daysDiff)
        }

        const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length
        const isConsistent = intervals.every((i) => Math.abs(i - avgInterval) <= toleranceDays)

        const avgAmount = txs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) / txs.length
        const amountConsistent = txs.every(
          (tx) => Math.abs(Math.abs(tx.amount) - avgAmount) / avgAmount <= amountTolerance
        )

        if (isConsistent && amountConsistent) {
          const frequency =
            avgInterval <= 8
              ? 'weekly'
              : avgInterval <= 35
                ? 'monthly'
                : avgInterval <= 100
                  ? 'quarterly'
                  : 'yearly'

          recurringSubscriptions.push({
            merchant_name: merchant,
            frequency,
            avg_interval_days: Math.round(avgInterval),
            avg_amount: avgAmount,
            occurrences: txs.length,
            first_transaction: txs[0].date,
            last_transaction: txs[txs.length - 1].date,
            next_predicted_date: new Date(
              new Date(txs[txs.length - 1].date).getTime() + avgInterval * 24 * 60 * 60 * 1000
            )
              .toISOString()
              .split('T')[0],
            confidence: isConsistent && amountConsistent ? 0.9 : 0.7,
            transaction_ids: txs.map((tx) => tx.transaction_id),
          })
        }
      })

      return {
        success: true,
        output: {
          recurring_subscriptions: recurringSubscriptions,
          metadata: {
            total_subscriptions_found: recurringSubscriptions.length,
            total_transactions_analyzed: transactions.length,
            date_range: {
              from: transactions[0]?.date,
              to: transactions[transactions.length - 1]?.date,
            },
          },
        },
      }
    },

    outputs: {
      recurring_subscriptions: {
        type: 'json',
        description:
          'Array of detected recurring subscriptions with frequency and predicted next date',
      },
      metadata: {
        type: 'json',
        description: 'Analysis metadata including total subscriptions found',
      },
    },
  }
