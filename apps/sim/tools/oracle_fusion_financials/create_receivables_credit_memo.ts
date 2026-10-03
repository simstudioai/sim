import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoDistributionCreateItemSchema,
  oracleFusionReceivablesCreditMemoLineCreateItemSchema,
  oracleFusionReceivablesCreditMemoOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesCreditMemoParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesCreditMemoTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesCreditMemoParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemo'>
> = {
  id: 'oracle_fusion_financials_create_receivables_credit_memo',
  name: 'Oracle Fusion Financials Create Receivables Credit Memo',
  description: 'Create Oracle Fusion receivables credit memo.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    businessUnit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Business Unit',
    },
    transactionNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction Number',
    },
    transactionDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction Date (YYYY-MM-DD)',
    },
    accountingDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounting Date (YYYY-MM-DD)',
    },
    billToCustomerName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill To Customer Name',
    },
    billToCustomerNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill To Customer Number',
    },
    billToSite: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill To Site',
    },
    creditMemoCurrency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Credit Memo Currency',
    },
    creditMemoStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Credit Memo Status',
    },
    creditReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Credit Reason',
    },
    freightCreditAmount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Freight Credit Amount',
    },
    transactionSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Source',
    },
    transactionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Type',
    },
    creditMemoComments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Credit Memo Comments',
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
    conversionRateDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Rate Date (YYYY-MM-DD)',
    },
    lines: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed lines to create with the receivables credit memo (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
      items: oracleFusionReceivablesCreditMemoLineCreateItemSchema,
      minItems: 1,
      maxItems: 1000,
    },
    distributions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed distributions to create with the receivables credit memo (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
      items: oracleFusionReceivablesCreditMemoDistributionCreateItemSchema,
      minItems: 1,
      maxItems: 1000,
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCreditMemo: {
      type: 'json',
      description: 'Projected receivables credit memo',
      properties: oracleFusionReceivablesCreditMemoOutputProperties,
    },
  },
}
