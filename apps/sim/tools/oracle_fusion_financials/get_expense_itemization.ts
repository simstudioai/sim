import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseItemizationOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetExpenseItemizationParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetExpenseItemizationTool: InternalToolConfig<
  OracleFusionFinancialsGetExpenseItemizationParams,
  OracleFusionFinancialsDetailResponse<'expenseItemization'>
> = {
  id: 'oracle_fusion_financials_get_expense_itemization',
  name: 'Oracle Fusion Financials Get Expense Itemization',
  description: 'Get an Oracle Fusion expense itemization.',
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
    expenseItemizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Itemization Id as an exact decimal string',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseItemization: {
      type: 'object',
      description: 'Projected expense itemization',
      properties: oracleFusionExpenseItemizationOutputProperties,
    },
  },
}
