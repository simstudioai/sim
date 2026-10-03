import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmTransferOrderOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  transferOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transferOrderKey; preserve the key exactly'
  ),
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. Supported fields: MessageText. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmUpdateTransferOrderTool: InternalToolConfig<
  OracleFusionScmMutationParams<'transferOrderKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_update_transfer_order',
  name: 'Oracle Fusion SCM Update Transfer Order',
  description:
    'Update the MessageText on an existing transfer order header. Use Update Transfer Order Line to change quantities, dates, or line logistics.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    transferOrder: {
      type: 'object',
      description: 'The transfer order returned by Oracle',
      properties: oracleFusionScmTransferOrderOutputProperties,
    },
  },
}
