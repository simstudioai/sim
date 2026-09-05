import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmSupplyOrderLineOutputProperties,
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
  supplyOrderLineKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived supplyOrderLineKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetSupplyOrderLineTool: InternalToolConfig<
  OracleFusionScmDetailParams<'supplyRequestKey' | 'supplyOrderLineKey'>,
  OracleFusionScmDetailResponse<'supplyOrderLine'>
> = {
  id: 'oracle_fusion_scm_get_supply_order_line',
  name: 'Oracle Fusion SCM Get Supply Order Line',
  description: 'Get one supply order line beneath an Oracle supply request.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    supplyOrderLine: {
      type: 'object',
      description: 'The supply order line returned by Oracle',
      properties: oracleFusionScmSupplyOrderLineOutputProperties,
    },
  },
}
