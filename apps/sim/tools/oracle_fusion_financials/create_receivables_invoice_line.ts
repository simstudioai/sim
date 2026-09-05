import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesInvoiceLineParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesInvoiceLineTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesInvoiceLineParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoiceLine'>
> = {
  id: 'oracle_fusion_financials_create_receivables_invoice_line',
  name: 'Oracle Fusion Financials Create Receivables Invoice Line',
  description: 'Create Oracle Fusion receivables invoice line.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    lineNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Number',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description',
    },
    itemNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Item Number',
    },
    memoLine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Memo Line',
    },
    lineAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Amount',
    },
    quantity: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quantity',
    },
    unitSellingPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit Selling Price',
    },
    unitOfMeasure: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit Of Measure',
    },
    accountingRule: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounting Rule',
    },
    accountingRuleDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounting Rule Duration as an exact decimal string',
    },
    ruleStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rule Start Date (YYYY-MM-DD)',
    },
    ruleEndDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rule End Date (YYYY-MM-DD)',
    },
    taxClassificationCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tax Classification Code',
    },
    salesOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sales Order',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoiceLine: {
      type: 'json',
      description: 'Projected receivables invoice line',
      properties: oracleFusionReceivablesInvoiceLineOutputProperties,
    },
  },
}
