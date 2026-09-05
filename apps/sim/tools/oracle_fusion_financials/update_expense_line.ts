import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionExpenseLineOutputProperties,
  oracleFusionFinancialsAuthParamFields,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateExpenseLineParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateExpenseLineTool: InternalToolConfig<
  OracleFusionFinancialsUpdateExpenseLineParams,
  OracleFusionFinancialsDetailResponse<'expenseLine'>
> = {
  id: 'oracle_fusion_financials_update_expense_line',
  name: 'Oracle Fusion Financials Update Expense Line',
  description: 'Update an Oracle Fusion expense line.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
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
    assignmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignment Id as an exact integer string',
    },
    orgId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Org Id as an exact integer string',
    },
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person Id as an exact integer string',
    },
    ticketClass: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket Class',
    },
    expenseTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense Type Id as an exact integer string',
    },
    expenseTemplateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense Template Id as an exact integer string',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description',
    },
    justification: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Justification',
    },
    receiptAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Amount',
    },
    receiptCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Currency Code',
    },
    receiptDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Date (YYYY-MM-DD)',
    },
    merchantName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Merchant Name',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start Date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End Date',
    },
    exchangeRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exchange Rate',
    },
    reimbursementCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reimbursement Currency Code',
    },
    itemizationParentExpenseId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Itemization Parent Expense Id as an exact integer string',
    },
    receiptMissingFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Receipt Missing Flag',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location',
    },
    countryCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country Code',
    },
    expenseCategoryCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense Category Code',
    },
    expenseSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense Source',
    },
    numberOfDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number Of Days',
    },
    numberOfAttendees: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number Of Attendees',
    },
    tripDistance: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trip Distance',
    },
    distanceUnitCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Distance Unit Code',
    },
    ticketClassCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket Class Code',
    },
    ticketNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ticket Number',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    expenseLine: {
      type: 'object',
      description: 'Projected expense line',
      properties: oracleFusionExpenseLineOutputProperties,
    },
  },
}
