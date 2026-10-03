import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceDistributionOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesInvoiceDistributionParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesInvoiceDistributionTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesInvoiceDistributionParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoiceDistribution'>
> = {
  id: 'oracle_fusion_financials_get_receivables_invoice_distribution',
  name: 'Oracle Fusion Financials Get Receivables Invoice Distribution',
  description: 'Get Oracle Fusion receivables invoice distribution.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    receivablesInvoiceDistributionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Distribution Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoiceDistribution: {
      type: 'json',
      description: 'Projected receivables invoice distribution',
      properties: oracleFusionReceivablesInvoiceDistributionOutputProperties,
    },
  },
}
