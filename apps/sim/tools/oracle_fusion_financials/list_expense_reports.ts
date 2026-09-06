import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportOutputProperties,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListExpenseReportsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListExpenseReportsTool: InternalToolConfig<
  OracleFusionFinancialsListExpenseReportsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_expense_reports',
  name: 'Oracle Fusion Financials List Expense Reports',
  description: 'List one bounded page of Oracle Fusion expense reports.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Expense Reports in this page',
      items: { type: 'object', properties: oracleFusionExpenseReportOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
