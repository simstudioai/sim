import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesReceiptOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesReceiptParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesReceiptTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesReceiptParams,
  OracleFusionFinancialsDetailResponse<'receivablesReceipt'>
> = {
  id: 'oracle_fusion_financials_get_receivables_receipt',
  name: 'Oracle Fusion Financials Get Receivables Receipt',
  description: 'Get Oracle Fusion receivables receipt.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesReceiptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Receipt Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesReceipt: {
      type: 'json',
      description: 'Projected receivables receipt',
      properties: oracleFusionReceivablesReceiptOutputProperties,
    },
  },
}
