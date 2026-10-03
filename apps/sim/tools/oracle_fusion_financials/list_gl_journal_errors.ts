import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionGlJournalErrorOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListGlJournalErrorsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListGlJournalErrorsTool: InternalToolConfig<
  OracleFusionFinancialsListGlJournalErrorsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_gl_journal_errors',
  name: 'Oracle Fusion Financials List GL Journal Errors',
  description: 'List one bounded page of Oracle Fusion gl journal errors.',
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
      description: 'GL Journal Errors in this page',
      items: { type: 'object', properties: oracleFusionGlJournalErrorOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
