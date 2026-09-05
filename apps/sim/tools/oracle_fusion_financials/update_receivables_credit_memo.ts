import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateReceivablesCreditMemoParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateReceivablesCreditMemoTool: InternalToolConfig<
  OracleFusionFinancialsUpdateReceivablesCreditMemoParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemo'>
> = {
  id: 'oracle_fusion_financials_update_receivables_credit_memo',
  name: 'Oracle Fusion Financials Update Receivables Credit Memo',
  description: 'Update Oracle Fusion receivables credit memo.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
    allowCompletion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow Completion',
    },
    controlCompletionReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Control Completion Reason',
    },
    creditMemoStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Credit Memo Status',
    },
    recipientEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recipient Email',
    },
    transactionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Type',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCreditMemo: {
      type: 'json',
      description: 'Projected receivables credit memo',
      properties: oracleFusionReceivablesCreditMemoOutputProperties,
    },
  },
}
