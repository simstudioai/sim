import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsActionResponse,
  OracleFusionFinancialsApproveReceivablesCreditMemoParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsApproveReceivablesCreditMemoTool: InternalToolConfig<
  OracleFusionFinancialsApproveReceivablesCreditMemoParams,
  OracleFusionFinancialsActionResponse
> = {
  id: 'oracle_fusion_financials_approve_receivables_credit_memo',
  name: 'Oracle Fusion Financials Approve Receivables Credit Memo',
  description:
    'Approve a pending-approval Oracle Fusion receivables credit memo. Returns the action result, not a refreshed transaction.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
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
