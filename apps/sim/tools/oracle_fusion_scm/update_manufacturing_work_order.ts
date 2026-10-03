import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmManufacturingWorkOrderOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  manufacturingWorkOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived manufacturingWorkOrderKey; preserve the key exactly'
  ),
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. Supported fields: PlannedStartQuantity, WorkOrderDescription, WorkOrderStatusCode, WorkOrderSubType, WorkOrderPriority, PlannedStartDate, PlannedCompletionDate, WorkDefinitionId, WorkDefinitionCode, SupplyType. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmUpdateManufacturingWorkOrderTool: InternalToolConfig<
  OracleFusionScmMutationParams<'manufacturingWorkOrderKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_update_manufacturing_work_order',
  name: 'Oracle Fusion SCM Update Manufacturing Work Order',
  description:
    'Update Manufacturing Work Order using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    manufacturingWorkOrder: {
      type: 'object',
      description: 'The manufacturing work order returned by Oracle',
      properties: oracleFusionScmManufacturingWorkOrderOutputProperties,
    },
  },
}
