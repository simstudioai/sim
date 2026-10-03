import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionGlJournalHeaderOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetGlJournalHeaderParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetGlJournalHeaderTool: InternalToolConfig<
  OracleFusionFinancialsGetGlJournalHeaderParams,
  OracleFusionFinancialsDetailResponse<'glJournalHeader'>
> = {
  id: 'oracle_fusion_financials_get_gl_journal_header',
  name: 'Oracle Fusion Financials Get GL Journal Header',
  description: 'Get an Oracle Fusion gl journal header.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    glJournalBatchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Batch Id returned by Oracle; preserve it exactly',
    },
    glJournalHeaderUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Header Uniq Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    glJournalHeader: {
      type: 'object',
      description: 'Projected gl journal header',
      properties: oracleFusionGlJournalHeaderOutputProperties,
    },
  },
}
