import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportProcessingDetailOutputProperties,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListExpenseReportProcessingDetailsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListExpenseReportProcessingDetailsTool: InternalToolConfig<
  OracleFusionFinancialsListExpenseReportProcessingDetailsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_expense_report_processing_details',
  name: 'Oracle Fusion Financials List Expense Report Processing Details',
  description: 'List one bounded page of Oracle Fusion expense report processing details.',
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
      description: 'Expense Report Processing Details in this page',
      items: {
        type: 'object',
        properties: oracleFusionExpenseReportProcessingDetailOutputProperties,
      },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
