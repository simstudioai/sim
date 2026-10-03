import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmSupplyRequestOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  supplyRequestKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived supplyRequestKey; preserve the key exactly'
  ),
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. SupplyOrderReferenceNumber can rename the request and returns its new key; clearing it with null is not supported. Supported fields: SupplyOrderReferenceId, SupplyOrderReferenceNumber, ProcessRequestFlag, AllowPartialRequestFlag, TrustedSource, TransferCostAmount, TransferCostCurrencyCode, TransferCostTypeName, supplyRequestLines. Provide at least one field. supplyRequestLines: up to 100 objects with InterfaceBatchNumber, ProcessStatus, Quantity, SupplyType, UOMCode, ItemId, ItemNumber, SupplyOrderReferenceLineId, SupplyOrderReferenceLineNumber, NeedByDate, RequestedShipDate, SourceOrganizationId, SourceOrganizationCode, SourceSubinventoryCode, DestinationOrganizationId, DestinationOrganizationCode, DestinationSubinventoryCode, DestinationTypeCode, SupplyOperation, Comments. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmUpdateSupplyRequestTool: InternalToolConfig<
  OracleFusionScmMutationParams<'supplyRequestKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_update_supply_request',
  name: 'Oracle Fusion SCM Update Supply Request',
  description:
    'Update Supply Request using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    supplyRequest: {
      type: 'object',
      description: 'The supply request returned by Oracle',
      properties: oracleFusionScmSupplyRequestOutputProperties,
    },
  },
}
