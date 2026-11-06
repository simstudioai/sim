import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateExpenseReportParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateExpenseReportTool: InternalToolConfig<
  OracleFusionFinancialsUpdateExpenseReportParams,
  OracleFusionFinancialsDetailResponse<'expenseReport'>
> = {
  id: 'oracle_fusion_financials_update_expense_report',
  name: 'Oracle Fusion Financials Update Expense Report',
  description: 'Update an Oracle Fusion expense report.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    expenseReportUniqId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense Report Uniq Id returned by Oracle; preserve it exactly',
    },
    orgId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Org Id as an exact integer string',
    },
    purpose: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purpose',
    },
    expenseReportDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense Report Date (YYYY-MM-DD)',
    },
    reimbursementCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reimbursement Currency Code',
    },
    exchangeRateType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exchange Rate Type',
    },
    paymentMethodCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment Method Code',
    },
    overrideApproverId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override Approver Id as an exact integer string',
    },
    unappliedAdvancesJust: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unapplied Advances Just',
    },
    unappliedCashAdvReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unapplied Cash Adv Reason',
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
