import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseLineErrorOutputProperties,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListExpenseLineErrorsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListExpenseLineErrorsTool: InternalToolConfig<
  OracleFusionFinancialsListExpenseLineErrorsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_expense_line_errors',
  name: 'Oracle Fusion Financials List Expense Line Errors',
  description: 'List one bounded page of Oracle Fusion expense line errors.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
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
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Expense Line Errors in this page',
      items: { type: 'object', properties: oracleFusionExpenseLineErrorOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
