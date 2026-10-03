import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoDistributionOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesCreditMemoDistributionParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesCreditMemoDistributionTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesCreditMemoDistributionParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemoDistribution'>
> = {
  id: 'oracle_fusion_financials_create_receivables_credit_memo_distribution',
  name: 'Oracle Fusion Financials Create Receivables Credit Memo Distribution',
  description: 'Create Oracle Fusion receivables credit memo distribution.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
    accountClass: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account Class',
    },
    accountCombination: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account Combination',
    },
    accountedAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounted Amount',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount',
    },
    creditMemoLineNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Credit Memo Line Number',
    },
    detailedTaxLineNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed Tax Line Number',
    },
    percent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Percent',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comments',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCreditMemoDistribution: {
      type: 'json',
      description: 'Projected receivables credit memo distribution',
      properties: oracleFusionReceivablesCreditMemoDistributionOutputProperties,
    },
  },
}
