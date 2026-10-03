import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesInvoiceInstallmentOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsUpdateReceivablesInvoiceInstallmentParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsUpdateReceivablesInvoiceInstallmentTool: InternalToolConfig<
  OracleFusionFinancialsUpdateReceivablesInvoiceInstallmentParams,
  OracleFusionFinancialsDetailResponse<'receivablesInvoiceInstallment'>
> = {
  id: 'oracle_fusion_financials_update_receivables_invoice_installment',
  name: 'Oracle Fusion Financials Update Receivables Invoice Installment',
  description: 'Update Oracle Fusion receivables invoice installment.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesInvoiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Id (exact decimal resource identifier)',
    },
    receivablesInvoiceInstallmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Invoice Installment Id (exact decimal resource identifier)',
    },
    installmentDueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Installment Due Date (YYYY-MM-DD)',
    },
    originalAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Original Amount',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesInvoiceInstallment: {
      type: 'json',
      description: 'Projected receivables invoice installment',
      properties: oracleFusionReceivablesInvoiceInstallmentOutputProperties,
    },
  },
}
