import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionGlJournalBatchOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetGlJournalBatchParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetGlJournalBatchTool: InternalToolConfig<
  OracleFusionFinancialsGetGlJournalBatchParams,
  OracleFusionFinancialsDetailResponse<'glJournalBatch'>
> = {
  id: 'oracle_fusion_financials_get_gl_journal_batch',
  name: 'Oracle Fusion Financials Get GL Journal Batch',
  description: 'Get an Oracle Fusion gl journal batch.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
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
    glJournalBatch: {
      type: 'object',
      description: 'Projected gl journal batch',
      properties: oracleFusionGlJournalBatchOutputProperties,
    },
  },
}
