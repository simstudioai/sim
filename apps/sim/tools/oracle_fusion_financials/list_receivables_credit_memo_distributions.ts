import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesCreditMemoDistributionOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesCreditMemoDistributionsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesCreditMemoDistributionsTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesCreditMemoDistributionsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_credit_memo_distributions',
  name: 'Oracle Fusion Financials List Receivables Credit Memo Distributions',
  description: 'List one page of Oracle Fusion receivables credit memo distributions.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'receivables credit memo distributions in this page',
      items: {
        type: 'object',
        properties: oracleFusionReceivablesCreditMemoDistributionOutputProperties,
      },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
