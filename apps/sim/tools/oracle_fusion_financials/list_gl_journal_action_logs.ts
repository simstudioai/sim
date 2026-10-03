import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionGlJournalActionLogOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListGlJournalActionLogsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListGlJournalActionLogsTool: InternalToolConfig<
  OracleFusionFinancialsListGlJournalActionLogsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_gl_journal_action_logs',
  name: 'Oracle Fusion Financials List GL Journal Action Logs',
  description: 'List one bounded page of Oracle Fusion gl journal action logs.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
    glJournalBatchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Batch Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'GL Journal Action Logs in this page',
      items: { type: 'object', properties: oracleFusionGlJournalActionLogOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
