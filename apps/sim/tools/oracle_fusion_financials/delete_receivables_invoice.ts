import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDeleteReceivablesInvoiceParams,
  OracleFusionFinancialsDeleteResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsDeleteReceivablesInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsDeleteReceivablesInvoiceParams,
  OracleFusionFinancialsDeleteResponse
> = {
  id: 'oracle_fusion_financials_delete_receivables_invoice',
  name: 'Oracle Fusion Financials Delete Receivables Invoice',
  description:
    'Delete an Oracle Fusion receivables invoice when its current lifecycle state permits deletion.',
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
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    id: { type: 'string', description: 'Deleted resource identifier' },
  },
}
