import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseLineErrorOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetExpenseLineErrorParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetExpenseLineErrorTool: InternalToolConfig<
  OracleFusionFinancialsGetExpenseLineErrorParams,
  OracleFusionFinancialsDetailResponse<'expenseLineError'>
> = {
  id: 'oracle_fusion_financials_get_expense_line_error',
  name: 'Oracle Fusion Financials Get Expense Line Error',
  description: 'Get an Oracle Fusion expense line error.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    expenseReportUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
    expenseLineUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Line Uniq Id returned by Oracle; preserve it exactly',
    },
    expenseLineErrorSequence: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Line Error Sequence as an exact decimal string',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseLineError: {
      type: 'object',
      description: 'Projected expense line error',
      properties: oracleFusionExpenseLineErrorOutputProperties,
    },
  },
}
