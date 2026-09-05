import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionInstallmentOutputProperties,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsInvoiceChildListParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListPayablesInvoiceInstallmentsTool: InternalToolConfig<
  OracleFusionFinancialsInvoiceChildListParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_payables_invoice_installments',
  name: 'Oracle Fusion Financials List Payables Invoice Installments',
  description: 'List one page of payment installments for an Oracle Fusion Payables invoice.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
    ...oracleFusionFinancialsListParamFields,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Invoice installments in this page',
      items: { type: 'object', properties: oracleFusionInstallmentOutputProperties },
    },
    count: { type: 'number', description: 'Number of records in this page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle has another page' },
    limit: { type: 'number', description: 'Page size returned by Oracle' },
    offset: { type: 'number', description: 'Offset returned by Oracle' },
    totalResults: {
      type: 'number',
      description: 'Estimated total matching records when requested',
      optional: true,
    },
  },
}
