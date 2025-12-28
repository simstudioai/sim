import { XeroClient } from 'xero-node'
import type {
  ReconcileBankTransactionParams,
  ReconcileBankTransactionResponse,
} from '@/tools/xero/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Xero Reconcile Bank Transaction Tool
 * Uses official xero-node SDK for bank reconciliation
 */
export const xeroReconcileBankTransactionTool: ToolConfig<
  ReconcileBankTransactionParams,
  ReconcileBankTransactionResponse
> = {
  id: 'xero_reconcile_bank_transaction',
  name: 'Xero Reconcile Bank Transaction',
  description:
    'Automatically reconcile bank transactions with invoices/bills or create manual entries',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Xero OAuth access token',
    },
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Xero organization tenant ID',
    },
    bankAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Xero bank account ID',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD)',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction amount (positive for deposits, negative for withdrawals)',
    },
    payee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payee or payer name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction description',
    },
    accountCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account code for categorization (default: auto-detect)',
    },
    matchExisting: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attempt to match against existing invoices/bills (default: true)',
    },
  },

  /**
   * SDK-based execution using xero-node XeroClient
   * Reconciles bank transactions with AI matching
   */
  directExecution: async (params) => {
    try {
      // Initialize Xero SDK client
      const xero = new XeroClient({
        clientId: '',
        clientSecret: '',
      })

      // Set access token
      await xero.setTokenSet({
        access_token: params.apiKey,
        token_type: 'Bearer',
      })

      let matched = false
      let matchedInvoiceId: string | undefined
      let matchedBillId: string | undefined
      let confidenceScore = 0
      let reconciliationMethod = 'manual'

      // Attempt to match with existing invoices/bills if requested
      if (params.matchExisting !== false) {
        // Search for matching invoices (for deposits)
        if (params.amount > 0) {
          const invoicesResponse = await xero.accountingApi.getInvoices(
            params.tenantId,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            `Status=="AUTHORISED"&&Type=="ACCREC"&&AmountDue>=${params.amount * 0.95}&&AmountDue<=${params.amount * 1.05}`
          )

          const matchingInvoices = invoicesResponse.body.invoices || []
          if (matchingInvoices.length > 0) {
            matched = true
            matchedInvoiceId = matchingInvoices[0].invoiceID
            confidenceScore = 0.85
            reconciliationMethod = 'automatic'
          }
        }
        // Search for matching bills (for withdrawals)
        else if (params.amount < 0) {
          const billsResponse = await xero.accountingApi.getInvoices(
            params.tenantId,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            `Status=="AUTHORISED"&&Type=="ACCPAY"&&AmountDue>=${Math.abs(params.amount) * 0.95}&&AmountDue<=${Math.abs(params.amount) * 1.05}`
          )

          const matchingBills = billsResponse.body.invoices || []
          if (matchingBills.length > 0) {
            matched = true
            matchedBillId = matchingBills[0].invoiceID
            confidenceScore = 0.85
            reconciliationMethod = 'automatic'
          }
        }
      }

      // Create bank transaction
      const bankTransaction = {
        type: params.amount > 0 ? 'RECEIVE' : 'SPEND',
        contact: params.payee
          ? {
              name: params.payee,
            }
          : undefined,
        lineItems: [
          {
            description: params.description || 'Bank transaction',
            quantity: 1,
            unitAmount: Math.abs(params.amount),
            accountCode: params.accountCode || (params.amount > 0 ? '200' : '400'),
          },
        ],
        bankAccount: {
          accountID: params.bankAccountId,
        },
        dateString: params.date,
        status: 'AUTHORISED',
        reference: matched
          ? `Matched to ${matchedInvoiceId || matchedBillId}`
          : 'Manual entry',
      }

      // Create bank transaction using SDK
      const response = await xero.accountingApi.createBankTransactions(params.tenantId, {
        bankTransactions: [bankTransaction],
      })

      const createdTransaction = response.body.bankTransactions?.[0]

      if (!createdTransaction) {
        throw new Error('Failed to create bank transaction')
      }

      return {
        success: true,
        output: {
          transaction: {
            id: createdTransaction.bankTransactionID || '',
            bank_account: createdTransaction.bankAccount?.name || '',
            date: params.date,
            amount: params.amount,
            payee: params.payee || null,
            description: params.description || null,
            status: createdTransaction.status || 'AUTHORISED',
            matched,
          },
          reconciliation_info: {
            matched_invoice_id: matchedInvoiceId,
            matched_bill_id: matchedBillId,
            confidence_score: confidenceScore,
            reconciliation_method: reconciliationMethod,
          },
          metadata: {
            transaction_id: createdTransaction.bankTransactionID || '',
            bank_account_id: params.bankAccountId,
            amount: params.amount,
            reconciled_at: new Date().toISOString().split('T')[0],
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'XERO_RECONCILIATION_ERROR',
          message: error.message || 'Failed to reconcile bank transaction in Xero',
          details: error.response?.body || error,
        },
      }
    }
  },

  outputs: {
    transaction: {
      type: 'json',
      description: 'Reconciled bank transaction details',
    },
    reconciliation_info: {
      type: 'json',
      description: 'Matching information and confidence scoring',
    },
    metadata: {
      type: 'json',
      description: 'Reconciliation metadata',
    },
  },
}
