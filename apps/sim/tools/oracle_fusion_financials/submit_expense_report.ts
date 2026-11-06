import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsActionResponse,
  OracleFusionFinancialsSubmitExpenseReportParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsSubmitExpenseReportTool: InternalToolConfig<
  OracleFusionFinancialsSubmitExpenseReportParams,
  OracleFusionFinancialsActionResponse
> = {
  id: 'oracle_fusion_financials_submit_expense_report',
  name: 'Oracle Fusion Financials Submit Expense Report',
  description:
    'Submit an Oracle Fusion expense report. Only result S means submission without errors; other results are returned as business failures.',
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
    result: { type: 'string', description: 'Documented Oracle action result' },
  },
}
