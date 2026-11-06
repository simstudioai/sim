import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsActionResponse,
  OracleFusionFinancialsApplyReceivablesReceiptParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsApplyReceivablesReceiptTool: InternalToolConfig<
  OracleFusionFinancialsApplyReceivablesReceiptParams,
  OracleFusionFinancialsActionResponse
> = {
  id: 'oracle_fusion_financials_apply_receivables_receipt',
  name: 'Oracle Fusion Financials Apply Receivables Receipt',
  description:
    'Apply a standard receipt to a Receivables invoice installment. An omitted amount applies the full open transaction balance.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesReceiptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Receipt Id (exact decimal resource identifier)',
    },
    appliedPaymentScheduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice installment identifier as an exact decimal string',
    },
    amountApplied: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount to apply; omitted means the full open transaction balance',
    },
    calledFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Caller or process name recorded for audit',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    result: { type: 'string', description: 'Oracle action result; success is reported separately' },
  },
}
