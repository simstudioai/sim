import QuickBooks from 'node-quickbooks'
import type { CreateBillPaymentParams, BillPaymentResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateBillPaymentTool: ToolConfig<
  CreateBillPaymentParams,
  BillPaymentResponse
> = {
  id: 'quickbooks_create_bill_payment',
  name: 'QuickBooks Create Bill Payment',
  description: 'Record a payment for a bill in QuickBooks Online',
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
    VendorRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor reference: { value: "vendorId" }',
    },
    TotalAmt: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Total amount of the payment',
    },
    APAccountRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Accounts Payable account reference: { value: "accountId" }',
    },
    PayType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment type (Check, Cash, CreditCard)',
    },
    TxnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD format). Defaults to today.',
    },
    Line: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of line items linking to specific bills',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const billPayment: Record<string, any> = {
        VendorRef: params.VendorRef,
        TotalAmt: params.TotalAmt,
        APAccountRef: params.APAccountRef,
        PayType: params.PayType || 'Check',
      }

      if (params.TxnDate) billPayment.TxnDate = params.TxnDate
      if (params.Line) billPayment.Line = params.Line

      const createdBillPayment = await new Promise<any>((resolve, reject) => {
        qbo.createBillPayment(billPayment, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          billPayment: createdBillPayment,
          metadata: {
            Id: createdBillPayment.Id,
            TotalAmt: createdBillPayment.TotalAmt,
            TxnDate: createdBillPayment.TxnDate,
            PayType: createdBillPayment.PayType,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_CREATE_BILL_PAYMENT_ERROR',
          message: error.message || 'Failed to create bill payment',
          details: error,
        },
      }
    }
  },

  outputs: {
    billPayment: {
      type: 'json',
      description: 'The created QuickBooks bill payment object',
    },
    metadata: {
      type: 'json',
      description: 'Bill payment summary metadata',
    },
  },
}
