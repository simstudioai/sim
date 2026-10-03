import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionReceivablesCustomerAccountSiteOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListReceivablesCustomerAccountSitesParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListReceivablesCustomerAccountSitesTool: InternalToolConfig<
  OracleFusionFinancialsListReceivablesCustomerAccountSitesParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_receivables_customer_account_sites',
  name: 'Oracle Fusion Financials List Receivables Customer Account Sites',
  description: 'List one page of Oracle Fusion receivables customer account sites.',
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
      description: 'receivables customer account sites in this page',
      items: {
        type: 'object',
        properties: oracleFusionReceivablesCustomerAccountSiteOutputProperties,
      },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
