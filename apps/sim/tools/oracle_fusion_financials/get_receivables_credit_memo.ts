import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesCreditMemoParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesCreditMemoTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesCreditMemoParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemo'>
> = {
  id: 'oracle_fusion_financials_get_receivables_credit_memo',
  name: 'Oracle Fusion Financials Get Receivables Credit Memo',
  description: 'Get Oracle Fusion receivables credit memo.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
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
    receivablesCreditMemo: {
      type: 'json',
      description: 'Projected receivables credit memo',
      properties: oracleFusionReceivablesCreditMemoOutputProperties,
    },
  },
}
