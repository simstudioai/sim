import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesReceiptOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesReceiptParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesReceiptTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesReceiptParams,
  OracleFusionFinancialsDetailResponse<'receivablesReceipt'>
> = {
  id: 'oracle_fusion_financials_create_receivables_receipt',
  name: 'Oracle Fusion Financials Create Receivables Receipt',
  description: 'Create Oracle Fusion receivables receipt.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount',
    },
    businessUnit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Business Unit',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Currency',
    },
    receiptDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Receipt Date (YYYY-MM-DD)',
    },
    receiptMethod: {
      type: 'string',
      required: true,
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
