import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInvoiceOutputProperties,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsInvoiceParams,
  OracleFusionFinancialsInvoiceResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsInvoiceParams,
  OracleFusionFinancialsInvoiceResponse
> = {
  id: 'oracle_fusion_financials_get_payables_invoice',
  name: 'Oracle Fusion Financials Get Payables Invoice',
  description: 'Get one Oracle Fusion Payables invoice by its opaque Oracle resource key.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoice: {
      type: 'object',
      description: 'The Payables invoice',
      properties: oracleFusionInvoiceOutputProperties,
    },
  },
}
