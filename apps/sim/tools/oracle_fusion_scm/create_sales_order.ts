import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmSalesOrderOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. Supported fields: BusinessUnitId, SourceTransactionId, SourceTransactionNumber, SourceTransactionRevisionNumber, SourceTransactionSystem, BuyingPartyId, BuyingPartyNumber, BuyingPartyName, CustomerPONumber, TransactionalCurrencyCode, TransactionOn, RequestedShipDate, RequestedArrivalDate, Comments, SubmittedFlag, lines. Required: BusinessUnitId, SourceTransactionId, SourceTransactionNumber, SourceTransactionRevisionNumber, SourceTransactionSystem, and a non-empty lines array. lines: up to 100 objects with OrderedQuantity, OrderedUOMCode, ProductId, ProductNumber, SourceScheduleNumber, SourceTransactionLineId, SourceTransactionLineNumber, SourceTransactionScheduleId, RequestedShipDate, RequestedArrivalDate, RequestedFulfillmentOrganizationId, RequestedFulfillmentOrganizationCode, UnitListPrice, UnitSellingPrice, Comments. Each requires OrderedQuantity, OrderedUOMCode, ProductId, SourceScheduleNumber, SourceTransactionLineId, SourceTransactionLineNumber, SourceTransactionScheduleId. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields. Set SubmittedFlag explicitly: false creates a draft; true requests validation and submission.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmCreateSalesOrderTool: InternalToolConfig<
  OracleFusionScmMutationParams,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_create_sales_order',
  name: 'Oracle Fusion SCM Create Sales Order',
  description:
    'Create Sales Order using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
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
