import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmTransferOrderLineOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  transferOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transferOrderKey; preserve the key exactly'
  ),
  transferOrderLineKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transferOrderLineKey; preserve the key exactly'
  ),
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. Supported fields: Action, RequestedQuantity, SecondaryRequestedQuantity, NeedByDate, ScheduledShipDate, Comments, SourceOrganizationId, SourceOrganizationCode, SourceSubinventoryCode, DestinationSubinventoryCode, SourceLocatorId, DestinationLocatorId, NoteToReceiver, NoteToSupplier, ShipmentPriority. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmUpdateTransferOrderLineTool: InternalToolConfig<
  OracleFusionScmMutationParams<'transferOrderKey' | 'transferOrderLineKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_update_transfer_order_line',
  name: 'Oracle Fusion SCM Update Transfer Order Line',
  description:
    'Update Transfer Order Line using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    transferOrderLine: {
      type: 'object',
      description: 'The transfer order line returned by Oracle',
      properties: oracleFusionScmTransferOrderLineOutputProperties,
    },
  },
}
