import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportPaymentOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetExpenseReportPaymentParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetExpenseReportPaymentTool: InternalToolConfig<
  OracleFusionFinancialsGetExpenseReportPaymentParams,
  OracleFusionFinancialsDetailResponse<'expenseReportPayment'>
> = {
  id: 'oracle_fusion_financials_get_expense_report_payment',
  name: 'Oracle Fusion Financials Get Expense Report Payment',
  description: 'Get an Oracle Fusion expense report payment.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    expenseReportUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
    expenseReportPaymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Payment Id as an exact decimal string',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseReportPayment: {
      type: 'object',
      description: 'Projected expense report payment',
      properties: oracleFusionExpenseReportPaymentOutputProperties,
    },
  },
}
