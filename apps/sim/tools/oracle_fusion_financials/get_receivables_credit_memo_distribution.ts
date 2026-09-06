import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoDistributionOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesCreditMemoDistributionParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesCreditMemoDistributionTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesCreditMemoDistributionParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemoDistribution'>
> = {
  id: 'oracle_fusion_financials_get_receivables_credit_memo_distribution',
  name: 'Oracle Fusion Financials Get Receivables Credit Memo Distribution',
  description: 'Get Oracle Fusion receivables credit memo distribution.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
    receivablesCreditMemoDistributionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Distribution Id (exact decimal resource identifier)',
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
