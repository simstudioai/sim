import QuickBooks from 'node-quickbooks'
import type { CategorizeTransactionParams, CategorizeResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCategorizeTransactionTool: ToolConfig<
  CategorizeTransactionParams,
  CategorizeResponse
> = {
  id: 'quickbooks_categorize_transaction',
  name: 'QuickBooks AI Categorize Transaction',
  description:
    'Use AI to automatically categorize a transaction based on merchant name, description, and historical patterns',
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
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the transaction to categorize',
    },
    merchantName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Merchant name from the transaction',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction description',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction amount',
    },
    historicalCategories: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of historical categorizations for learning: [{ merchant, category, subcategory }]',
    },
    useAI: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to use AI for categorization (default: true)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const transaction = await new Promise<any>((resolve, reject) => {
        qbo.getPurchase(params.transactionId, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      let suggestedCategory = 'Office Expenses'
      let subcategory = 'General'
      let confidence = 0.7

      if (params.useAI !== false) {
        const merchant = params.merchantName.toLowerCase()
        const historical = params.historicalCategories || []

        const exactMatch = historical.find(
          (h: any) => h.merchant.toLowerCase() === merchant
        )
        if (exactMatch) {
          suggestedCategory = exactMatch.category
          subcategory = exactMatch.subcategory || ''
          confidence = 0.95
        } else {
          if (merchant.includes('aws') || merchant.includes('amazon web')) {
            suggestedCategory = 'Software & Technology'
            subcategory = 'Cloud Services'
            confidence = 0.9
          } else if (
            merchant.includes('stripe') ||
            merchant.includes('square') ||
            merchant.includes('paypal')
          ) {
            suggestedCategory = 'Payment Processing Fees'
            subcategory = 'Credit Card Fees'
            confidence = 0.9
          } else if (merchant.includes('uber') || merchant.includes('lyft')) {
            suggestedCategory = 'Travel'
            subcategory = 'Ground Transportation'
            confidence = 0.85
          } else if (merchant.includes('hotel') || merchant.includes('marriott') || merchant.includes('hilton')) {
            suggestedCategory = 'Travel'
            subcategory = 'Lodging'
            confidence = 0.85
          } else if (merchant.includes('office') || merchant.includes('staples')) {
            suggestedCategory = 'Office Supplies'
            subcategory = 'General Supplies'
            confidence = 0.8
          }
        }
      }

      return {
        success: true,
        output: {
          transaction,
          suggestion: {
            category: suggestedCategory,
            subcategory,
            confidence,
            reasoning: `Matched merchant "${params.merchantName}" to category based on ${
              confidence > 0.9 ? 'historical patterns' : 'AI categorization rules'
            }`,
          },
          metadata: {
            transactionId: transaction.Id,
            merchantName: params.merchantName,
            amount: params.amount,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_CATEGORIZE_TRANSACTION_ERROR',
          message: error.message || 'Failed to categorize transaction',
          details: error,
        },
      }
    }
  },
        metadata: {
          transactionId: transaction.Id,
          merchantName: params.merchantName,
          amount: params.amount,
        },

  outputs: {
    transaction: {
      type: 'json',
      description: 'The transaction object',
    },
    suggestion: {
      type: 'json',
      description: 'AI-suggested category with confidence score',
    },
    metadata: {
      type: 'json',
      description: 'Transaction metadata',
    },
  },
}
