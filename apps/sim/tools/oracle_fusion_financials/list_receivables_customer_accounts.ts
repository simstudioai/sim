import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesCustomerAccountOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesCustomerAccountsParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesCustomerAccountsTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesCustomerAccountsParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_customer_accounts',
  name: 'Oracle Fusion Financials List Receivables Customer Accounts',
  description: 'List one page of Oracle Fusion receivables customer accounts.',
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
      description: 'receivables customer accounts in this page',
      items: { type: 'object', properties: oracleFusionReceivablesCustomerAccountOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
