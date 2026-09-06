import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateReceivablesInvoiceParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateReceivablesInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsUpdateReceivablesInvoiceParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoice'>
> = {
  id: 'oracle_fusion_financials_update_receivables_invoice',
  name: 'Oracle Fusion Financials Update Receivables Invoice',
  description: 'Update Oracle Fusion receivables invoice.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    invoiceStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice Status',
    },
    paymentTerms: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment Terms',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Date (YYYY-MM-DD)',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoice: {
      type: 'json',
      description: 'Projected receivables invoice',
      properties: oracleFusionReceivablesInvoiceOutputProperties,
    },
  },
}
