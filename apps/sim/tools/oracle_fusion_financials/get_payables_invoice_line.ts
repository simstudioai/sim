import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInvoiceLineOutputProperties,
  oracleFusionInvoiceLineParamField,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsInvoiceLineParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesInvoiceLineTool: InternalToolConfig<
  OracleFusionFinancialsInvoiceLineParams,
  OracleFusionFinancialsDetailResponse<'invoiceLine'>
> = {
  id: 'oracle_fusion_financials_get_payables_invoice_line',
  name: 'Oracle Fusion Financials Get Payables Invoice Line',
  description: 'Get one Oracle Fusion Payables invoice line by its Oracle-derived opaque key.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
    invoiceLineUniqId: oracleFusionInvoiceLineParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoiceLine: {
      type: 'object',
      description: 'The Payables invoice line',
      properties: oracleFusionInvoiceLineOutputProperties,
    },
  },
}
