import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInstallmentOutputProperties,
  oracleFusionInvoiceInstallmentParamField,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsDetailResponse,
  OracleFusionFinancialsInvoiceInstallmentParams,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesInvoiceInstallmentTool: InternalToolConfig<
  OracleFusionFinancialsInvoiceInstallmentParams,
  OracleFusionFinancialsDetailResponse<'invoiceInstallment'>
> = {
  id: 'oracle_fusion_financials_get_payables_invoice_installment',
  name: 'Oracle Fusion Financials Get Payables Invoice Installment',
  description: 'Get one Oracle Fusion Payables invoice installment by its opaque key.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
    invoiceInstallmentUniqId: oracleFusionInvoiceInstallmentParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    invoiceInstallment: {
      type: 'object',
      description: 'The Payables invoice installment',
      properties: oracleFusionInstallmentOutputProperties,
    },
  },
}
