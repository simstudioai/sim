import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetExpenseReportParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetExpenseReportTool: InternalToolConfig<
  OracleFusionFinancialsGetExpenseReportParams,
  OracleFusionFinancialsDetailResponse<'expenseReport'>
> = {
  id: 'oracle_fusion_financials_get_expense_report',
  name: 'Oracle Fusion Financials Get Expense Report',
  description: 'Get an Oracle Fusion expense report.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    expenseReportUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseReport: {
      type: 'object',
      description: 'Projected expense report',
      properties: oracleFusionExpenseReportOutputProperties,
    },
  },
}
