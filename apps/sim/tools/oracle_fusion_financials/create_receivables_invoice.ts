import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceDistributionCreateItemSchema,
  oracleFusionReceivablesInvoiceLineCreateItemSchema,
  oracleFusionReceivablesInvoiceOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesInvoiceParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesInvoiceTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesInvoiceParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoice'>
> = {
  id: 'oracle_fusion_financials_create_receivables_invoice',
  name: 'Oracle Fusion Financials Create Receivables Invoice',
  description: 'Create Oracle Fusion receivables invoice.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    businessUnit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Business Unit',
    },
    transactionNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Number',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Date (YYYY-MM-DD)',
    },
    accountingDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounting Date (YYYY-MM-DD)',
    },
    billToCustomerName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill To Customer Name',
    },
    billToCustomerNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill To Customer Number',
    },
    billToSite: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill To Site',
    },
    invoiceCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice Currency Code',
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
    transactionSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Source',
    },
    transactionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction Type',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comments',
    },
    purchaseOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purchase Order',
    },
    conversionRateType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Rate Type',
    },
    conversionRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Rate',
    },
    conversionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion Date (YYYY-MM-DD)',
    },
    lines: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed lines to create with the receivables invoice (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
      items: oracleFusionReceivablesInvoiceLineCreateItemSchema,
      minItems: 1,
      maxItems: 1000,
    },
    distributions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed distributions to create with the receivables invoice (at most 1000). Use Oracle attribute names; exact integer attributes must be strings.',
      items: oracleFusionReceivablesInvoiceDistributionCreateItemSchema,
      minItems: 1,
      maxItems: 1000,
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
