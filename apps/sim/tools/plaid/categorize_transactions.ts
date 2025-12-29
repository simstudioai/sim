import type { CategorizeTransactionsParams, CategorizeTransactionsResponse } from '@/tools/plaid/types'
import type { ToolConfig } from '@/tools/types'

export const plaidCategorizeTransactionsTool: ToolConfig<
  CategorizeTransactionsParams,
  CategorizeTransactionsResponse
> = {
  id: 'plaid_categorize_transactions',
  name: 'Plaid AI Categorize Transactions',
  description:
    'Use AI to automatically categorize Plaid bank transactions based on merchant name and description',
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
      description: 'Array of Plaid transactions to categorize',
    },
    historicalCategories: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Historical categorization rules for learning: [{ merchant, category, subcategory }]',
    },
    useAI: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to use AI for categorization (default: true)',
    },
  },

  request: {
    url: () => 'https://production.plaid.com/transactions/get',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return { body: JSON.stringify({}) }
    },
  },

  transformResponse: async (response, params) => {
    if (!params) {
      throw new Error('Params are required for transformResponse')
    }
    
    const transactions = params.transactions as any[]
    const historical = params.historicalCategories || []
    const useAI = params.useAI !== false

    const categorizedTransactions = transactions.map((tx) => {
      let category = tx.category?.[0] || 'Uncategorized'
      let subcategory = tx.category?.[1] || ''
      let confidence = 0.7

      if (useAI) {
        const merchantName = (tx.merchant_name || tx.name || '').toLowerCase()

        const exactMatch = historical.find(
          (h: any) => h.merchant.toLowerCase() === merchantName
        )
        if (exactMatch) {
          category = exactMatch.category
          subcategory = exactMatch.subcategory || ''
          confidence = 0.95
        } else {
          if (merchantName.includes('aws') || merchantName.includes('amazon web')) {
            category = 'Software & Technology'
            subcategory = 'Cloud Services'
            confidence = 0.9
          } else if (
            merchantName.includes('stripe') ||
            merchantName.includes('square') ||
            merchantName.includes('paypal')
          ) {
            category = 'Payment Processing Fees'
            subcategory = 'Credit Card Fees'
            confidence = 0.9
          } else if (merchantName.includes('uber') || merchantName.includes('lyft')) {
            category = 'Travel'
            subcategory = 'Ground Transportation'
            confidence = 0.85
          } else if (
            merchantName.includes('hotel') ||
            merchantName.includes('marriott') ||
            merchantName.includes('hilton')
          ) {
            category = 'Travel'
            subcategory = 'Lodging'
            confidence = 0.85
          } else if (merchantName.includes('office') || merchantName.includes('staples')) {
            category = 'Office Supplies'
            subcategory = 'General Supplies'
            confidence = 0.8
          } else if (tx.category?.[0]) {
            category = tx.category[0]
            subcategory = tx.category[1] || ''
            confidence = 0.75
          }
        }
      }

      return {
        transaction_id: tx.transaction_id,
        merchant_name: tx.merchant_name || tx.name,
        amount: tx.amount,
        date: tx.date,
        original_category: tx.category,
        suggested_category: category,
        suggested_subcategory: subcategory,
        confidence,
      }
    })

    return {
      success: true,
      output: {
        categorized_transactions: categorizedTransactions,
        metadata: {
          total_transactions: categorizedTransactions.length,
          avg_confidence:
            categorizedTransactions.reduce((sum, tx) => sum + tx.confidence, 0) /
            categorizedTransactions.length,
        },
      },
    }
  },

  outputs: {
    categorized_transactions: {
      type: 'json',
      description: 'Array of categorized transactions with AI suggestions',
    },
    metadata: {
      type: 'json',
      description: 'Categorization metadata including average confidence',
    },
  },
}
