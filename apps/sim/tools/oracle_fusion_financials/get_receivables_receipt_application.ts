import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesReceiptApplicationOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesReceiptApplicationParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesReceiptApplicationTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesReceiptApplicationParams,
  OracleFusionFinancialsDetailResponse<'receivablesReceiptApplication'>
> = {
  id: 'oracle_fusion_financials_get_receivables_receipt_application',
  name: 'Oracle Fusion Financials Get Receivables Receipt Application',
  description: 'Get Oracle Fusion receivables receipt application.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCustomerAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Id (exact decimal resource identifier)',
    },
    receivablesReceiptApplicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Receipt Application Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesReceiptApplication: {
      type: 'json',
      description: 'Projected receivables receipt application',
      properties: oracleFusionReceivablesReceiptApplicationOutputProperties,
    },
  },
}
