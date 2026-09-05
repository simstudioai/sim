import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesTransactionPaymentScheduleOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesTransactionPaymentScheduleParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesTransactionPaymentScheduleTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesTransactionPaymentScheduleParams,
  OracleFusionFinancialsDetailResponse<'receivablesTransactionPaymentSchedule'>
> = {
  id: 'oracle_fusion_financials_get_receivables_transaction_payment_schedule',
  name: 'Oracle Fusion Financials Get Receivables Transaction Payment Schedule',
  description: 'Get Oracle Fusion receivables transaction payment schedule.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCustomerAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Id (exact decimal resource identifier)',
    },
    receivablesTransactionPaymentScheduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'receivables Transaction Payment Schedule Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesTransactionPaymentSchedule: {
      type: 'json',
      description: 'Projected receivables transaction payment schedule',
      properties: oracleFusionReceivablesTransactionPaymentScheduleOutputProperties,
    },
  },
}
