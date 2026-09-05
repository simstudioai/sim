import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmSupplyRequestOutputProperties,
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
      'JSON object. Supported fields: InterfaceBatchNumber, InterfaceSourceCode, SupplyOrderSource, SupplyRequestDate, SupplyRequestStatus, TrustedSource, SupplyOrderReferenceId, SupplyOrderReferenceNumber, ProcessRequestFlag, AllowPartialRequestFlag, supplyRequestLines. Required: InterfaceBatchNumber, SupplyOrderSource, SupplyRequestDate, SupplyRequestStatus, TrustedSource, and a non-empty supplyRequestLines array. supplyRequestLines: up to 100 objects with InterfaceBatchNumber, ProcessStatus, Quantity, SupplyType, UOMCode, ItemId, ItemNumber, SupplyOrderReferenceLineId, SupplyOrderReferenceLineNumber, NeedByDate, RequestedShipDate, SourceOrganizationId, SourceOrganizationCode, SourceSubinventoryCode, DestinationOrganizationId, DestinationOrganizationCode, DestinationSubinventoryCode, DestinationTypeCode, SupplyOperation, Comments. Each requires InterfaceBatchNumber, ProcessStatus, Quantity, SupplyType, UOMCode. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmCreateSupplyRequestTool: InternalToolConfig<
  OracleFusionScmMutationParams,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_create_supply_request',
  name: 'Oracle Fusion SCM Create Supply Request',
  description:
    'Create Supply Request using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
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
