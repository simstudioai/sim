import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDeleteReceivablesReceiptParams,
  OracleFusionFinancialsDeleteResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsDeleteReceivablesReceiptTool: InternalToolConfig<
  OracleFusionFinancialsDeleteReceivablesReceiptParams,
  OracleFusionFinancialsDeleteResponse
> = {
  id: 'oracle_fusion_financials_delete_receivables_receipt',
  name: 'Oracle Fusion Financials Delete Receivables Receipt',
  description:
    'Delete an Oracle Fusion receivables receipt when its current lifecycle state permits deletion.',
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
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    id: { type: 'string', description: 'Deleted resource identifier' },
  },
}
