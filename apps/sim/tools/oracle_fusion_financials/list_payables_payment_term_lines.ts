import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionDecimalIdParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionFinancialsListParamFields,
  oracleFusionPaymentTermLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsListResponse,
  OracleFusionFinancialsPaymentTermLineListParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsListPayablesPaymentTermLinesTool: InternalToolConfig<
  OracleFusionFinancialsPaymentTermLineListParams,
  OracleFusionFinancialsListResponse
> = {
  id: 'oracle_fusion_financials_list_payables_payment_term_lines',
  name: 'Oracle Fusion Financials List Payables Payment Term Lines',
  description: 'List one page of calculation lines for a Payables payment term.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    termsId: oracleFusionDecimalIdParamField('Oracle termsId as a decimal string'),
    ...oracleFusionFinancialsListParamFields,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Payables payment term lines in this page',
      items: { type: 'object', properties: oracleFusionPaymentTermLineOutputProperties },
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
