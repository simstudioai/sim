import QuickBooks from 'node-quickbooks'
import type { CreateEstimateParams, EstimateResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksCreateEstimate')

export const quickbooksCreateEstimateTool: ToolConfig<CreateEstimateParams, EstimateResponse> = {
  id: 'quickbooks_create_estimate',
  name: 'QuickBooks Create Estimate',
  description: 'Create a new estimate/quote in QuickBooks Online',
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
    CustomerRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer reference: { value: "customerId", name: "Customer Name" }',
    },
    Line: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of line items for the estimate',
    },
    TxnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD format). Defaults to today.',
    },
    ExpirationDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expiration date (YYYY-MM-DD format)',
    },
    DocNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Estimate number (auto-generated if not provided)',
    },
    BillEmail: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing email: { Address: "email@example.com" }',
    },
  },

  directExecution: async (params) => {
    try {
      // Validate transaction date if provided (must be in past or today)
      if (params.TxnDate) {
        const txnDateValidation = validateDate(params.TxnDate, {
          fieldName: 'transaction date',
          allowFuture: false,
          allowPast: true,
          required: false,
        })
        if (!txnDateValidation.valid) {
          logger.error('Transaction date validation failed', { error: txnDateValidation.error })
          return {
            success: false,
            output: {},
            error: `QUICKBOOKS_VALIDATION_ERROR: ${txnDateValidation.error}`,
          }
        }
      }

      // Validate expiration date if provided (can be past for expired estimates)
      if (params.ExpirationDate) {
        const expirationDateValidation = validateDate(params.ExpirationDate, {
          fieldName: 'expiration date',
          allowPast: true,
          allowFuture: true,
          required: false,
        })
        if (!expirationDateValidation.valid) {
          logger.error('Expiration date validation failed', { error: expirationDateValidation.error })
          return {
            success: false,
            output: {},
            error: `QUICKBOOKS_VALIDATION_ERROR: ${expirationDateValidation.error}`,
          }
        }
      }

      // Validate date relationship: transaction date must be before or equal to expiration date
      if (params.TxnDate && params.ExpirationDate) {
        const txnDate = new Date(params.TxnDate)
        const expirationDate = new Date(params.ExpirationDate)
        if (txnDate > expirationDate) {
          logger.error('Date relationship validation failed', {
            txnDate: params.TxnDate,
            expirationDate: params.ExpirationDate,
          })
          return {
            success: false,
            output: {},
            error: 'QUICKBOOKS_VALIDATION_ERROR: Transaction date cannot be after expiration date',
          }
        }
      }

      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const estimate: Record<string, any> = {
        CustomerRef: params.CustomerRef,
        Line: params.Line,
      }

      if (params.TxnDate) estimate.TxnDate = params.TxnDate
      if (params.ExpirationDate) estimate.ExpirationDate = params.ExpirationDate
      if (params.DocNumber) estimate.DocNumber = params.DocNumber
      if (params.BillEmail) estimate.BillEmail = params.BillEmail

      const createdEstimate = await new Promise<any>((resolve, reject) => {
        qbo.createEstimate(estimate, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          estimate: createdEstimate,
          metadata: {
            Id: createdEstimate.Id,
            DocNumber: createdEstimate.DocNumber,
            TotalAmt: createdEstimate.TotalAmt,
            TxnDate: createdEstimate.TxnDate,
            ExpirationDate: createdEstimate.ExpirationDate,
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
        error: `QUICKBOOKS_CREATE_ESTIMATE_ERROR: Failed to create estimate - ${errorDetails}`,
      }
    }
  },

  outputs: {
    estimate: {
      type: 'json',
      description: 'The created QuickBooks estimate object',
    },
    metadata: {
      type: 'json',
      description: 'Estimate summary metadata',
    },
  },
}
