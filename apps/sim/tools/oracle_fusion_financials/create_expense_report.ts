import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseReportOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateExpenseReportParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateExpenseReportTool: InternalToolConfig<
  OracleFusionFinancialsCreateExpenseReportParams,
  OracleFusionFinancialsDetailResponse<'expenseReport'>
> = {
  id: 'oracle_fusion_financials_create_expense_report',
  name: 'Oracle Fusion Financials Create Expense Report',
  description: 'Create an Oracle Fusion expense report.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Org Id as an exact integer string',
    },
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person Id as an exact integer string',
    },
    assignmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignment Id as an exact integer string',
    },
    preparerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preparer Id as an exact integer string',
    },
    purpose: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purpose',
    },
    expenseReportNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense Report Number',
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
