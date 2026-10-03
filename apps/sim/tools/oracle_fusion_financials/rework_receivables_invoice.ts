import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsActionResponse,
  OracleFusionFinancialsReworkReceivablesInvoiceParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsReworkReceivablesInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsReworkReceivablesInvoiceParams,
  OracleFusionFinancialsActionResponse
> = {
  id: 'oracle_fusion_financials_rework_receivables_invoice',
  name: 'Oracle Fusion Financials Rework Receivables Invoice',
  description:
    'Request rework for a pending-approval Oracle Fusion receivables invoice. Returns the action result, not a refreshed transaction.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Note recorded in the approval audit history',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    result: { type: 'string', description: 'Oracle action result; success is reported separately' },
  },
}
