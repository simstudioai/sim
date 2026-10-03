import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCustomerAccountSiteOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsGetReceivablesCustomerAccountSiteParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetReceivablesCustomerAccountSiteTool: InternalToolConfig<
  OracleFusionFinancialsGetReceivablesCustomerAccountSiteParams,
  OracleFusionFinancialsDetailResponse<'receivablesCustomerAccountSite'>
> = {
  id: 'oracle_fusion_financials_get_receivables_customer_account_site',
  name: 'Oracle Fusion Financials Get Receivables Customer Account Site',
  description: 'Get Oracle Fusion receivables customer account site.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCustomerAccountSiteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Customer Account Site Id (exact decimal resource identifier)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCustomerAccountSite: {
      type: 'json',
      description: 'Projected receivables customer account site',
      properties: oracleFusionReceivablesCustomerAccountSiteOutputProperties,
    },
  },
}
