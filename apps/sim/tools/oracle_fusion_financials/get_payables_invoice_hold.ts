import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInvoiceHoldOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsInvoiceHoldParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesInvoiceHoldTool: InternalToolConfig<
  OracleFusionFinancialsInvoiceHoldParams,
  OracleFusionFinancialsDetailResponse<'invoiceHold'>
> = {
  id: 'oracle_fusion_financials_get_payables_invoice_hold',
  name: 'Oracle Fusion Financials Get Payables Invoice Hold',
  description: 'Get one Oracle Fusion Payables invoice hold and its release details.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    holdId: oracleFusionDecimalIdParamField('Oracle HoldId as a decimal string'),
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoiceHold: {
      type: 'object',
      description: 'The Payables invoice hold',
      properties: oracleFusionInvoiceHoldOutputProperties,
    },
  },
}
