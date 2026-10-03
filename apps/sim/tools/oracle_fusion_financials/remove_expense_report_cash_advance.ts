import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsActionResponse,
  OracleFusionFinancialsRemoveExpenseReportCashAdvanceParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsRemoveExpenseReportCashAdvanceTool: InternalToolConfig<
  OracleFusionFinancialsRemoveExpenseReportCashAdvanceParams,
  OracleFusionFinancialsActionResponse
> = {
  id: 'oracle_fusion_financials_remove_expense_report_cash_advance',
  name: 'Oracle Fusion Financials Remove Expense Report Cash Advance',
  description:
    'Remove the specified cash advance from an Oracle Fusion expense report. Result Y means removal succeeded; N means it failed.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    expenseReportUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
    cashAdvanceNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of the specific cash advance to remove',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    result: { type: 'string', description: 'Documented Oracle action result' },
  },
}
