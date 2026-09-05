import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesTransactionAdjustmentOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesTransactionAdjustmentsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesTransactionAdjustmentsTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesTransactionAdjustmentsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_transaction_adjustments',
  name: 'Oracle Fusion Financials List Receivables Transaction Adjustments',
  description: 'List one page of Oracle Fusion receivables transaction adjustments.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
    receivablesCustomerAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'receivables transaction adjustments in this page',
      items: {
        type: 'object',
        properties: oracleFusionReceivablesTransactionAdjustmentOutputProperties,
      },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
