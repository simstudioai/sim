import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesTransactionPaymentScheduleOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesTransactionPaymentSchedulesParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesTransactionPaymentSchedulesTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesTransactionPaymentSchedulesParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_transaction_payment_schedules',
  name: 'Oracle Fusion Financials List Receivables Transaction Payment Schedules',
  description: 'List one page of Oracle Fusion receivables transaction payment schedules.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
    receivablesCustomerAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'receivables transaction payment schedules in this page',
      items: {
        type: 'object',
        properties: oracleFusionReceivablesTransactionPaymentScheduleOutputProperties,
      },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
