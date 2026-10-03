import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionGlJournalActionLogOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetGlJournalActionLogParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetGlJournalActionLogTool: InternalToolConfig<
  OracleFusionFinancialsGetGlJournalActionLogParams,
  OracleFusionFinancialsDetailResponse<'glJournalActionLog'>
> = {
  id: 'oracle_fusion_financials_get_gl_journal_action_log',
  name: 'Oracle Fusion Financials Get GL Journal Action Log',
  description: 'Get an Oracle Fusion gl journal action log.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    glJournalBatchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Batch Id returned by Oracle; preserve it exactly',
    },
    glJournalActionLogUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Action Log Uniq Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    glJournalActionLog: {
      type: 'object',
      description: 'Projected gl journal action log',
      properties: oracleFusionGlJournalActionLogOutputProperties,
    },
  },
}
