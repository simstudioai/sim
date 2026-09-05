import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceDistributionOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesInvoiceDistributionParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesInvoiceDistributionTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesInvoiceDistributionParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoiceDistribution'>
> = {
  id: 'oracle_fusion_financials_create_receivables_invoice_distribution',
  name: 'Oracle Fusion Financials Create Receivables Invoice Distribution',
  description: 'Create Oracle Fusion receivables invoice distribution.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    accountClass: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account Class',
    },
    accountCombination: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account Combination',
    },
    accountedAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounted Amount',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount',
    },
    invoiceLineNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice Line Number',
    },
    detailedTaxLineNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed Tax Line Number',
    },
    percent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Percent',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comments',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoiceDistribution: {
      type: 'json',
      description: 'Projected receivables invoice distribution',
      properties: oracleFusionReceivablesInvoiceDistributionOutputProperties,
    },
  },
}
