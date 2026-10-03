import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesCreditMemoOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesCreditMemosParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesCreditMemosTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesCreditMemosParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_credit_memos',
  name: 'Oracle Fusion Financials List Receivables Credit Memos',
  description: 'List one page of Oracle Fusion receivables credit memos.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'receivables credit memos in this page',
      items: { type: 'object', properties: oracleFusionReceivablesCreditMemoOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
