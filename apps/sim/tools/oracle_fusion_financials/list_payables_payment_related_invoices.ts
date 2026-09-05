import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionCheckIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionPaymentRelatedInvoiceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListResponse,
  OracleFusionFinancialsPaymentRelatedInvoiceListParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListPayablesPaymentRelatedInvoicesTool: InternalToolConfig<
  OracleFusionFinancialsPaymentRelatedInvoiceListParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_payables_payment_related_invoices',
  name: 'Oracle Fusion Financials List Payables Payment Related Invoices',
  description: 'List one page of paid invoices related to a Payables payment.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    checkId: oracleFusionCheckIdParamField,
    ...oracleFusionFinancialsListParamFields,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Payment-related invoices in this page',
      items: { type: 'object', properties: oracleFusionPaymentRelatedInvoiceOutputProperties },
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
