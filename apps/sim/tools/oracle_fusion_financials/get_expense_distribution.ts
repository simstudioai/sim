import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseDistributionOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetExpenseDistributionParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetExpenseDistributionTool: InternalToolConfig<
  OracleFusionFinancialsGetExpenseDistributionParams,
  OracleFusionFinancialsDetailResponse<'expenseDistribution'>
> = {
  id: 'oracle_fusion_financials_get_expense_distribution',
  name: 'Oracle Fusion Financials Get Expense Distribution',
  description: 'Get an Oracle Fusion expense distribution.',
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
    expenseDistributionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Distribution Id as an exact decimal string',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseDistribution: {
      type: 'object',
      description: 'Projected expense distribution',
      properties: oracleFusionExpenseDistributionOutputProperties,
    },
  },
}
