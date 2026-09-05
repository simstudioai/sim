import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesReceiptOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateReceivablesReceiptParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateReceivablesReceiptTool: InternalToolConfig<
  OracleFusionFinancialsUpdateReceivablesReceiptParams,
  OracleFusionFinancialsDetailResponse<'receivablesReceipt'>
> = {
  id: 'oracle_fusion_financials_update_receivables_receipt',
  name: 'Oracle Fusion Financials Update Receivables Receipt',
  description: 'Update Oracle Fusion receivables receipt.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesReceiptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Receipt Id (exact decimal resource identifier)',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency',
    },
    receiptDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Date (YYYY-MM-DD)',
    },
    receiptMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Method',
    },
    receiptNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Number',
    },
    accountingDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounting Date (YYYY-MM-DD)',
    },
    customerAccountNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer Account Number',
    },
    customerName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer Name',
    },
    customerSite: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer Site',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comments',
    },
    conversionRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Rate',
    },
    conversionRateType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Rate Type',
    },
    conversionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Date (YYYY-MM-DD)',
    },
    maturityDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maturity Date (YYYY-MM-DD)',
    },
    structuredPaymentReference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Structured Payment Reference',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesReceipt: {
      type: 'json',
      description: 'Projected receivables receipt',
      properties: oracleFusionReceivablesReceiptOutputProperties,
    },
  },
}
