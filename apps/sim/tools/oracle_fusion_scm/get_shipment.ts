import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmShipmentOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  shipmentKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived shipmentKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetShipmentTool: InternalToolConfig<
  OracleFusionScmDetailParams<'shipmentKey'>,
  OracleFusionScmDetailResponse<'shipment'>
> = {
  id: 'oracle_fusion_scm_get_shipment',
  name: 'Oracle Fusion SCM Get Shipment',
  description: 'Get one shipment by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    shipment: {
      type: 'object',
      description: 'The shipment returned by Oracle',
      properties: oracleFusionScmShipmentOutputProperties,
    },
  },
}
