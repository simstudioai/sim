import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCustomerAccountOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesCustomerAccountParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesCustomerAccountTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesCustomerAccountParams,
  OracleFusionFinancialsDetailResponse<'receivablesCustomerAccount'>
> = {
  id: 'oracle_fusion_financials_get_receivables_customer_account',
  name: 'Oracle Fusion Financials Get Receivables Customer Account',
  description: 'Get Oracle Fusion receivables customer account.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
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
    receivablesCustomerAccount: {
      type: 'json',
      description: 'Projected receivables customer account',
      properties: oracleFusionReceivablesCustomerAccountOutputProperties,
    },
  },
}
