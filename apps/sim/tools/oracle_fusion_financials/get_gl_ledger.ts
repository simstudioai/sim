import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionGlLedgerOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetGlLedgerParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetGlLedgerTool: InternalToolConfig<
  OracleFusionFinancialsGetGlLedgerParams,
  OracleFusionFinancialsDetailResponse<'glLedger'>
> = {
  id: 'oracle_fusion_financials_get_gl_ledger',
  name: 'Oracle Fusion Financials Get GL Ledger',
  description: 'Get an Oracle Fusion gl ledger.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    glLedgerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GL Ledger Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    glLedger: {
      type: 'object',
      description: 'Projected gl ledger',
      properties: oracleFusionGlLedgerOutputProperties,
    },
  },
}
