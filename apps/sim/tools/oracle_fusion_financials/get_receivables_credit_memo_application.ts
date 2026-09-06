import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoApplicationOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesCreditMemoApplicationParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesCreditMemoApplicationTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesCreditMemoApplicationParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemoApplication'>
> = {
  id: 'oracle_fusion_financials_get_receivables_credit_memo_application',
  name: 'Oracle Fusion Financials Get Receivables Credit Memo Application',
  description: 'Get Oracle Fusion receivables credit memo application.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCustomerAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Id (exact decimal resource identifier)',
    },
    receivablesCreditMemoApplicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Application Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCreditMemoApplication: {
      type: 'json',
      description: 'Projected receivables credit memo application',
      properties: oracleFusionReceivablesCreditMemoApplicationOutputProperties,
    },
  },
}
