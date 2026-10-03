import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionAvailablePrepaymentOutputProperties,
  oracleFusionAvailablePrepaymentParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsAvailablePrepaymentParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesAvailablePrepaymentTool: InternalToolConfig<
  OracleFusionFinancialsAvailablePrepaymentParams,
  OracleFusionFinancialsDetailResponse<'availablePrepayment'>
> = {
  id: 'oracle_fusion_financials_get_payables_available_prepayment',
  name: 'Oracle Fusion Financials Get Payables Available Prepayment',
  description: 'Get one prepayment available to apply to a Payables invoice.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
    availablePrepaymentUniqId: oracleFusionAvailablePrepaymentParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    availablePrepayment: {
      type: 'object',
      description: 'The available prepayment',
      properties: oracleFusionAvailablePrepaymentOutputProperties,
    },
  },
}
