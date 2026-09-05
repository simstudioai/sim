import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionGlJournalErrorOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetGlJournalErrorParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetGlJournalErrorTool: InternalToolConfig<
  OracleFusionFinancialsGetGlJournalErrorParams,
  OracleFusionFinancialsDetailResponse<'glJournalError'>
> = {
  id: 'oracle_fusion_financials_get_gl_journal_error',
  name: 'Oracle Fusion Financials Get GL Journal Error',
  description: 'Get an Oracle Fusion gl journal error.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    glJournalBatchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Batch Id returned by Oracle; preserve it exactly',
    },
    glJournalErrorUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Error Uniq Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    glJournalError: {
      type: 'object',
      description: 'Projected gl journal error',
      properties: oracleFusionGlJournalErrorOutputProperties,
    },
  },
}
