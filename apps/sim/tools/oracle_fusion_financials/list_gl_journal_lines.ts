import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionGlJournalLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListGlJournalLinesParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListGlJournalLinesTool: InternalToolConfig<
  OracleFusionFinancialsListGlJournalLinesParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_gl_journal_lines',
  name: 'Oracle Fusion Financials List GL Journal Lines',
  description: 'List one bounded page of Oracle Fusion gl journal lines.',
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
    items: {
      type: 'array',
      description: 'GL Journal Lines in this page',
      items: { type: 'object', properties: oracleFusionGlJournalLineOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
