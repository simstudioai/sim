import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionAppliedPrepaymentOutputProperties,
  oracleFusionAppliedPrepaymentParamField,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionInvoiceParamField,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsAppliedPrepaymentParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsGetPayablesAppliedPrepaymentTool: InternalToolConfig<
  OracleFusionFinancialsAppliedPrepaymentParams,
  OracleFusionFinancialsDetailResponse<'appliedPrepayment'>
> = {
  id: 'oracle_fusion_financials_get_payables_applied_prepayment',
  name: 'Oracle Fusion Financials Get Payables Applied Prepayment',
  description: 'Get one prepayment already applied to a Payables invoice.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    invoiceUniqId: oracleFusionInvoiceParamField,
    appliedPrepaymentUniqId: oracleFusionAppliedPrepaymentParamField,
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    appliedPrepayment: {
      type: 'object',
      description: 'The applied prepayment',
      properties: oracleFusionAppliedPrepaymentOutputProperties,
    },
  },
}
