import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmSupplyRequestOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  supplyRequestKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived supplyRequestKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetSupplyRequestTool: InternalToolConfig<
  OracleFusionScmDetailParams<'supplyRequestKey'>,
  OracleFusionScmDetailResponse<'supplyRequest'>
> = {
  id: 'oracle_fusion_scm_get_supply_request',
  name: 'Oracle Fusion SCM Get Supply Request',
  description: 'Get one supply request by its opaque Oracle resource key.',
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
