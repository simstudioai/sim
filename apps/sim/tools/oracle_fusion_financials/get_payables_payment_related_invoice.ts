import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionCheckIdParamField,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionPaymentRelatedInvoiceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsPaymentRelatedInvoiceParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesPaymentRelatedInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsPaymentRelatedInvoiceParams,
  OracleFusionFinancialsDetailResponse<'paymentRelatedInvoice'>
> = {
  id: 'oracle_fusion_financials_get_payables_payment_related_invoice',
  name: 'Oracle Fusion Financials Get Payables Payment Related Invoice',
  description: 'Get one paid invoice related to an Oracle Fusion Payables payment.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    checkId: oracleFusionCheckIdParamField,
    invoicePaymentId: oracleFusionDecimalIdParamField(
      'Oracle InvoicePaymentId as a decimal string'
    ),
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    paymentRelatedInvoice: {
      type: 'object',
      description: 'The payment-related invoice',
      properties: oracleFusionPaymentRelatedInvoiceOutputProperties,
    },
  },
}
