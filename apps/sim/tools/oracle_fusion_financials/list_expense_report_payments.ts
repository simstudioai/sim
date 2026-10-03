import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportPaymentOutputProperties,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListExpenseReportPaymentsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListExpenseReportPaymentsTool: InternalToolConfig<
  OracleFusionFinancialsListExpenseReportPaymentsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_expense_report_payments',
  name: 'Oracle Fusion Financials List Expense Report Payments',
  description: 'List one bounded page of Oracle Fusion expense report payments.',
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
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Expense Report Payments in this page',
      items: { type: 'object', properties: oracleFusionExpenseReportPaymentOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
