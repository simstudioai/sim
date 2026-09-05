import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesTransactionAdjustmentOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesTransactionAdjustmentParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesTransactionAdjustmentTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesTransactionAdjustmentParams,
  OracleFusionFinancialsDetailResponse<'receivablesTransactionAdjustment'>
> = {
  id: 'oracle_fusion_financials_get_receivables_transaction_adjustment',
  name: 'Oracle Fusion Financials Get Receivables Transaction Adjustment',
  description: 'Get Oracle Fusion receivables transaction adjustment.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCustomerAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Id (exact decimal resource identifier)',
    },
    receivablesTransactionAdjustmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Transaction Adjustment Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesTransactionAdjustment: {
      type: 'json',
      description: 'Projected receivables transaction adjustment',
      properties: oracleFusionReceivablesTransactionAdjustmentOutputProperties,
    },
  },
}
