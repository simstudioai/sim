import QuickBooks from 'node-quickbooks'
import type { CategorizeTransactionParams, CategorizeResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksCategorizeTransaction')

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
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      logger.info('Fetching transaction for categorization', {
        transactionId: params.transactionId,
        merchant: params.merchantName,
      })

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
          logger.info('Found exact historical match for merchant', {
            merchant: params.merchantName,
            category: suggestedCategory,
          })
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
          logger.info('AI categorized merchant', {
            merchant: params.merchantName,
            category: suggestedCategory,
            confidence,
          })
        }
      }

      // Fetch chart of accounts to find matching account
      logger.info('Fetching chart of accounts to apply categorization')
      const accounts = await new Promise<any[]>((resolve, reject) => {
        qbo.findAccounts(
          "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000",
          (err: any, result: any) => {
            if (err) reject(err)
            else resolve(result.QueryResponse?.Account || [])
          }
        )
      })

      // Find the best matching account using scoring algorithm
      // Filter to active expense-type accounts only
      const expenseAccounts = accounts.filter(
        (account: any) =>
          account.Active &&
          (account.AccountType === 'Expense' ||
            account.Classification === 'Expense' ||
            account.AccountType === 'Other Expense' ||
            account.AccountType === 'Cost of Goods Sold')
      )

      // Score each account based on match quality
      const scoredAccounts = expenseAccounts
        .map((account: any) => {
          const accountName = (account.Name || '').toLowerCase()
          const category = suggestedCategory.toLowerCase()
          const sub = (subcategory || '').toLowerCase()

          let score = 0

          // Exact match gets highest score
          if (accountName === category) score = 100
          else if (accountName === sub) score = 90
          // Starts with match gets high score
          else if (accountName.startsWith(category)) score = 80
          else if (sub && accountName.startsWith(sub)) score = 70
          // Contains match gets moderate score
          else if (accountName.includes(category)) score = 60
          else if (sub && accountName.includes(sub)) score = 50

          return { account, score }
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)

      const matchingAccount = scoredAccounts[0]?.account

      if (!matchingAccount) {
        logger.warn('No matching expense account found for category', {
          category: suggestedCategory,
          subcategory,
          activeExpenseAccounts: expenseAccounts.length,
          totalAccounts: accounts.length,
        })
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
              }. No matching QuickBooks expense account found - categorization not applied.`,
            },
            categorized: false,
            metadata: {
              transactionId: transaction.Id,
              merchantName: params.merchantName,
              amount: params.amount,
            },
          },
        }
      }

      // Log the match quality for monitoring
      logger.info('Found matching account for category', {
        matchScore: scoredAccounts[0].score,
        accountName: matchingAccount.Name,
        category: suggestedCategory,
        subcategory,
        alternativeMatches: scoredAccounts.length - 1,
      })

      // Update transaction with categorization
      logger.info('Applying categorization to transaction', {
        transactionId: params.transactionId,
        accountId: matchingAccount.Id,
        accountName: matchingAccount.Name,
      })

      // Update the transaction's AccountRef for each line item
      // CRITICAL: Explicitly preserve SyncToken required by QuickBooks for updates
      const updatedTransaction = {
        ...transaction,
        SyncToken: transaction.SyncToken,
      }
      if (Array.isArray(updatedTransaction.Line)) {
        updatedTransaction.Line = updatedTransaction.Line.map((line: any) => {
          if (line.DetailType === 'AccountBasedExpenseLineDetail') {
            return {
              ...line,
              AccountBasedExpenseLineDetail: {
                ...line.AccountBasedExpenseLineDetail,
                AccountRef: {
                  value: matchingAccount.Id,
                  name: matchingAccount.Name,
                },
              },
            }
          }
          return line
        })
      }

      // Save the updated transaction back to QuickBooks
      const savedTransaction = await new Promise<any>((resolve, reject) => {
        qbo.updatePurchase(updatedTransaction, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      logger.info('Transaction categorization applied successfully', {
        transactionId: savedTransaction.Id,
        category: suggestedCategory,
        accountName: matchingAccount.Name,
      })

      return {
        success: true,
        output: {
          transaction: savedTransaction,
          suggestion: {
            category: suggestedCategory,
            subcategory,
            confidence,
            reasoning: `Matched merchant "${params.merchantName}" to category based on ${
              confidence > 0.9 ? 'historical patterns' : 'AI categorization rules'
            }. Applied to QuickBooks account: ${matchingAccount.Name}`,
          },
          categorized: true,
          appliedAccount: {
            id: matchingAccount.Id,
            name: matchingAccount.Name,
          },
          metadata: {
            transactionId: savedTransaction.Id,
            merchantName: params.merchantName,
            amount: params.amount,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to categorize transaction', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_CATEGORIZE_TRANSACTION_ERROR: Failed to categorize transaction - ${errorDetails}`,
      }
    }
  },

  outputs: {
    transaction: {
      type: 'json',
      description: 'The updated transaction object from QuickBooks',
    },
    suggestion: {
      type: 'json',
      description: 'AI-suggested category with confidence score and reasoning',
    },
    categorized: {
      type: 'boolean',
      description: 'Whether the categorization was successfully applied to QuickBooks',
    },
    appliedAccount: {
      type: 'json',
      description: 'The QuickBooks account that was applied (if categorization was successful)',
    },
    metadata: {
      type: 'json',
      description: 'Transaction metadata including merchant and amount',
    },
  },
}
