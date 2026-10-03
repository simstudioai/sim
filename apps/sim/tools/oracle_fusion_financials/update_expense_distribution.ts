import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseDistributionOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateExpenseDistributionParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateExpenseDistributionTool: InternalToolConfig<
  OracleFusionFinancialsUpdateExpenseDistributionParams,
  OracleFusionFinancialsDetailResponse<'expenseDistribution'>
> = {
  id: 'oracle_fusion_financials_update_expense_distribution',
  name: 'Oracle Fusion Financials Update Expense Distribution',
  description: 'Update an Oracle Fusion expense distribution.',
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
    expenseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Id as an exact integer string',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Org Id as an exact integer string',
    },
    codeCombinationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Code Combination Id as an exact integer string',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company',
    },
    costCenter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cost Center',
    },
    reimbursableAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reimbursable Amount',
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
