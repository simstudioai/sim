import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmSalesOrderOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  salesOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived salesOrderKey; preserve the key exactly'
  ),
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. Supported fields: SourceTransactionRevisionNumber, BuyingPartyId, BuyingPartyNumber, BuyingPartyName, CustomerPONumber, TransactionalCurrencyCode, RequestedShipDate, RequestedArrivalDate, Comments, SubmittedFlag, CanceledFlag, CancelReasonCode. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmUpdateSalesOrderTool: InternalToolConfig<
  OracleFusionScmMutationParams<'salesOrderKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_update_sales_order',
  name: 'Oracle Fusion SCM Update Sales Order',
  description:
    'Update Sales Order using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    salesOrder: {
      type: 'object',
      description: 'The sales order returned by Oracle',
      properties: oracleFusionScmSalesOrderOutputProperties,
    },
  },
}
