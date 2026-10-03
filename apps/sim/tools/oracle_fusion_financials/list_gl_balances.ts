import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionFinancialsPageOutputProperties,
  oracleFusionGlBalanceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListGlBalancesParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListGlBalancesTool: InternalToolConfig<
  OracleFusionFinancialsListGlBalancesParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_gl_balances',
  name: 'Oracle Fusion Financials List GL Balances',
  description: 'List one bounded page of Oracle Fusion gl balances.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
    finder: {
      ...oracleFusionFinancialsListParamFields.finder,
      description:
        'AccountBalanceFinder accepts ledgerName, accountCombination, accountingPeriod, currency, amountType, currencyType, and scenario. AccountGroupBalanceFinder accepts accountGroupName, accountName, accountingPeriod, currency, and ledgerName.',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'GL Balances in this page',
      items: { type: 'object', properties: oracleFusionGlBalanceOutputProperties },
    },
    ...oracleFusionFinancialsPageOutputProperties,
  },
}
