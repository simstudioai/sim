import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesReceiptOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesReceiptsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesReceiptsTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesReceiptsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_receipts',
  name: 'Oracle Fusion Financials List Receivables Receipts',
  description: 'List one page of Oracle Fusion receivables receipts.',
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
      description: 'receivables receipts in this page',
      items: { type: 'object', properties: oracleFusionReceivablesReceiptOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
