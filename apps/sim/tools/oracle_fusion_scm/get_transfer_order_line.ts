import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmTransferOrderLineOutputProperties,
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
  transferOrderLineKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transferOrderLineKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetTransferOrderLineTool: InternalToolConfig<
  OracleFusionScmDetailParams<'transferOrderKey' | 'transferOrderLineKey'>,
  OracleFusionScmDetailResponse<'transferOrderLine'>
> = {
  id: 'oracle_fusion_scm_get_transfer_order_line',
  name: 'Oracle Fusion SCM Get Transfer Order Line',
  description: 'Get one transfer order line using Oracle-derived keys within its selected parent.',
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
