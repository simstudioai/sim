import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionPaymentProcessRequestOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsPaymentProcessRequestParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPaymentProcessRequestTool: InternalToolConfig<
  OracleFusionFinancialsPaymentProcessRequestParams,
  OracleFusionFinancialsDetailResponse<'paymentProcessRequest'>
> = {
  id: 'oracle_fusion_financials_get_payment_process_request',
  name: 'Oracle Fusion Financials Get Payment Process Request',
  description: 'Get one Oracle Fusion payment process request and its current status.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    paymentProcessRequestId: oracleFusionDecimalIdParamField(
      'Oracle PaymentProcessRequestId as a decimal string'
    ),
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    paymentProcessRequest: {
      type: 'object',
      description: 'The payment process request',
      properties: oracleFusionPaymentProcessRequestOutputProperties,
    },
  },
}
