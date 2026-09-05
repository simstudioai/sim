import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionCheckIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionPaymentOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsPaymentParams,
  OracleFusionFinancialsPaymentResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesPaymentTool: InternalToolConfig<
  OracleFusionFinancialsPaymentParams,
  OracleFusionFinancialsPaymentResponse
> = {
  id: 'oracle_fusion_financials_get_payables_payment',
  name: 'Oracle Fusion Financials Get Payables Payment',
  description: 'Get one Oracle Fusion Payables payment by its CheckId.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    checkId: oracleFusionCheckIdParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    payment: {
      type: 'object',
      description: 'The Payables payment',
      properties: oracleFusionPaymentOutputProperties,
    },
  },
}
