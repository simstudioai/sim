import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionPaymentTermLineOutputProperties,
  oracleFusionPaymentTermLineParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsPaymentTermLineParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesPaymentTermLineTool: InternalToolConfig<
  OracleFusionFinancialsPaymentTermLineParams,
  OracleFusionFinancialsDetailResponse<'paymentTermLine'>
> = {
  id: 'oracle_fusion_financials_get_payables_payment_term_line',
  name: 'Oracle Fusion Financials Get Payables Payment Term Line',
  description: 'Get one calculation line for an Oracle Fusion Payables payment term.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    termsId: oracleFusionDecimalIdParamField('Oracle termsId as a decimal string'),
    paymentTermLineUniqId: oracleFusionPaymentTermLineParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    paymentTermLine: {
      type: 'object',
      description: 'The Payables payment term line',
      properties: oracleFusionPaymentTermLineOutputProperties,
    },
  },
}
