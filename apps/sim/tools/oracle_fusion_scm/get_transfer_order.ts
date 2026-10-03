import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmTransferOrderOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  transferOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transferOrderKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetTransferOrderTool: InternalToolConfig<
  OracleFusionScmDetailParams<'transferOrderKey'>,
  OracleFusionScmDetailResponse<'transferOrder'>
> = {
  id: 'oracle_fusion_scm_get_transfer_order',
  name: 'Oracle Fusion SCM Get Transfer Order',
  description: 'Get one transfer order using Oracle-derived keys.',
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
