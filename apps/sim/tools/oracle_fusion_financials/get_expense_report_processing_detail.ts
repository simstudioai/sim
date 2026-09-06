import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportProcessingDetailOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetExpenseReportProcessingDetailParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetExpenseReportProcessingDetailTool: InternalToolConfig<
  OracleFusionFinancialsGetExpenseReportProcessingDetailParams,
  OracleFusionFinancialsDetailResponse<'expenseReportProcessingDetail'>
> = {
  id: 'oracle_fusion_financials_get_expense_report_processing_detail',
  name: 'Oracle Fusion Financials Get Expense Report Processing Detail',
  description: 'Get an Oracle Fusion expense report processing detail.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    expenseReportUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
    expenseReportProcessingDetailUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Expense Report Processing Detail Uniq Id returned by Oracle; preserve it exactly',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseReportProcessingDetail: {
      type: 'object',
      description: 'Projected expense report processing detail',
      properties: oracleFusionExpenseReportProcessingDetailOutputProperties,
    },
  },
}
