import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInvoiceDistributionOutputProperties,
  oracleFusionInvoiceLineParamField,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsInvoiceDistributionParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesInvoiceDistributionTool: InternalToolConfig<
  OracleFusionFinancialsInvoiceDistributionParams,
  OracleFusionFinancialsDetailResponse<'invoiceDistribution'>
> = {
  id: 'oracle_fusion_financials_get_payables_invoice_distribution',
  name: 'Oracle Fusion Financials Get Payables Invoice Distribution',
  description: 'Get one accounting distribution for an Oracle Fusion Payables invoice line.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
    invoiceLineUniqId: oracleFusionInvoiceLineParamField,
    invoiceDistributionId: oracleFusionDecimalIdParamField(
      'Oracle InvoiceDistributionId as a decimal string'
    ),
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoiceDistribution: {
      type: 'object',
      description: 'The Payables invoice distribution',
      properties: oracleFusionInvoiceDistributionOutputProperties,
    },
  },
}
