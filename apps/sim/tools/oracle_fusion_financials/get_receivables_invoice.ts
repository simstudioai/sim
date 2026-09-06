import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesInvoiceParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesInvoiceParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoice'>
> = {
  id: 'oracle_fusion_financials_get_receivables_invoice',
  name: 'Oracle Fusion Financials Get Receivables Invoice',
  description: 'Get Oracle Fusion receivables invoice.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoice: {
      type: 'json',
      description: 'Projected receivables invoice',
      properties: oracleFusionReceivablesInvoiceOutputProperties,
    },
  },
}
