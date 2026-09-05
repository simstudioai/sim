import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionInvoiceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListInvoicesParams,
  OracleFusionFinancialsListResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListPayablesInvoicesTool: InternalToolConfig<
  OracleFusionFinancialsListInvoicesParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_payables_invoices',
  name: 'Oracle Fusion Financials List Payables Invoices',
  description: 'List one page of Oracle Fusion Payables invoices using a fixed safe projection.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    ...oracleFusionFinancialsListParamFields,
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Payables invoices in this page',
      items: { type: 'object', properties: oracleFusionInvoiceOutputProperties },
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
