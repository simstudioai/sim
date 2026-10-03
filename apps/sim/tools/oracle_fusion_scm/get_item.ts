import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmItemOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  itemKey: oracleFusionScmOpaqueKeyParam('Oracle-derived itemKey; preserve the key exactly'),
} satisfies ToolConfig['params']

export const oracleFusionScmGetItemTool: InternalToolConfig<
  OracleFusionScmDetailParams<'itemKey'>,
  OracleFusionScmDetailResponse<'item'>
> = {
  id: 'oracle_fusion_scm_get_item',
  name: 'Oracle Fusion SCM Get Item',
  description: 'Get one item by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'The item returned by Oracle',
      properties: oracleFusionScmItemOutputProperties,
    },
  },
}
