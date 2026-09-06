import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionPaymentTermOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsPaymentTermParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesPaymentTermTool: InternalToolConfig<
  OracleFusionFinancialsPaymentTermParams,
  OracleFusionFinancialsDetailResponse<'paymentTerm'>
> = {
  id: 'oracle_fusion_financials_get_payables_payment_term',
  name: 'Oracle Fusion Financials Get Payables Payment Term',
  description: 'Get one Oracle Fusion Payables payment term header.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    termsId: oracleFusionDecimalIdParamField('Oracle termsId as a decimal string'),
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    paymentTerm: {
      type: 'object',
      description: 'The Payables payment term',
      properties: oracleFusionPaymentTermOutputProperties,
    },
  },
}
