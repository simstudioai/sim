import QuickBooks from 'node-quickbooks'
import type { ReconcileBankTransactionParams, ReconcileResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksReconcileBankTransactionTool: ToolConfig<
  ReconcileBankTransactionParams,
  ReconcileResponse
> = {
  id: 'quickbooks_reconcile_bank_transaction',
  name: 'QuickBooks Reconcile Bank Transaction',
  description:
    'Match and reconcile a bank transaction to an existing QuickBooks expense or invoice',
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
    bankTransactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the bank transaction to reconcile',
    },
    matchType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of transaction to match: Expense, Invoice, or Payment',
    },
    matchedTransactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the QuickBooks transaction to match with',
    },
    confidence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'AI confidence score for the match (0.0-1.0)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const reconciliation = {
        Id: params.bankTransactionId,
        LinkedTxn: [
          {
            TxnId: params.matchedTransactionId,
            TxnType: params.matchType,
          },
        ],
        sparse: true,
        PrivateNote: params.confidence
          ? `Auto-reconciled with ${(params.confidence * 100).toFixed(1)}% confidence`
          : 'Reconciled via API',
      }

      const updatedTransaction = await new Promise<any>((resolve, reject) => {
        qbo.updatePurchase(reconciliation, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          reconciliation: updatedTransaction,
          metadata: {
            bankTransactionId: updatedTransaction.Id,
            matchedTransactionId: updatedTransaction.LinkedTxn?.[0]?.TxnId,
            matchType: updatedTransaction.LinkedTxn?.[0]?.TxnType,
            status: 'reconciled',
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_RECONCILE_BANK_TRANSACTION_ERROR',
          message: error.message || 'Failed to reconcile transaction',
          details: error,
        },
      }
    }
  },

  outputs: {
    reconciliation: {
      type: 'json',
      description: 'The reconciled transaction object',
    },
    metadata: {
      type: 'json',
      description: 'Reconciliation metadata',
    },
  },
}
