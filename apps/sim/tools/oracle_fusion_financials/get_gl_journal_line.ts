import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionGlJournalLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetGlJournalLineParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetGlJournalLineTool: InternalToolConfig<
  OracleFusionFinancialsGetGlJournalLineParams,
  OracleFusionFinancialsDetailResponse<'glJournalLine'>
> = {
  id: 'oracle_fusion_financials_get_gl_journal_line',
  name: 'Oracle Fusion Financials Get GL Journal Line',
  description: 'Get an Oracle Fusion gl journal line.',
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
    glJournalLineUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Journal Line Uniq Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    glJournalLine: {
      type: 'object',
      description: 'Projected gl journal line',
      properties: oracleFusionGlJournalLineOutputProperties,
    },
  },
}
