import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOnHandQuantityOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  onHandQuantityKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived onHandQuantityKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetOnHandQuantityTool: InternalToolConfig<
  OracleFusionScmDetailParams<'onHandQuantityKey'>,
  OracleFusionScmDetailResponse<'onHandQuantity'>
> = {
  id: 'oracle_fusion_scm_get_on_hand_quantity',
  name: 'Oracle Fusion SCM Get On Hand Quantity',
  description: 'Get one on-hand quantity detail by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    onHandQuantity: {
      type: 'object',
      description: 'The on hand quantity returned by Oracle',
      properties: oracleFusionScmOnHandQuantityOutputProperties,
    },
  },
}
