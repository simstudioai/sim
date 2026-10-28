import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesInvoiceLineParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesInvoiceLineTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesInvoiceLineParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoiceLine'>
> = {
  id: 'oracle_fusion_financials_get_receivables_invoice_line',
  name: 'Oracle Fusion Financials Get Receivables Invoice Line',
  description: 'Get Oracle Fusion receivables invoice line.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    receivablesInvoiceLineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Line Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoiceLine: {
      type: 'json',
      description: 'Projected receivables invoice line',
      properties: oracleFusionReceivablesInvoiceLineOutputProperties,
    },
  },
}
