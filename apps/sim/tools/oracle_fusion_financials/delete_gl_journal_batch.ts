import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDeleteGlJournalBatchParams,
  OracleFusionFinancialsDeleteResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsDeleteGlJournalBatchTool: InternalToolConfig<
  OracleFusionFinancialsDeleteGlJournalBatchParams,
  OracleFusionFinancialsDeleteResponse
> = {
  id: 'oracle_fusion_financials_delete_gl_journal_batch',
  name: 'Oracle Fusion Financials Delete GL Journal Batch',
  description:
    'Delete an Oracle Fusion GL journal batch when its current lifecycle state permits deletion.',
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
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    id: { type: 'string', description: 'Deleted resource identifier' },
  },
}
