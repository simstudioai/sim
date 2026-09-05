import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesCreditMemoLineParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesCreditMemoLineTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesCreditMemoLineParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemoLine'>
> = {
  id: 'oracle_fusion_financials_get_receivables_credit_memo_line',
  name: 'Oracle Fusion Financials Get Receivables Credit Memo Line',
  description: 'Get Oracle Fusion receivables credit memo line.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
    receivablesCreditMemoLineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Line Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCreditMemoLine: {
      type: 'json',
      description: 'Projected receivables credit memo line',
      properties: oracleFusionReceivablesCreditMemoLineOutputProperties,
    },
  },
}
