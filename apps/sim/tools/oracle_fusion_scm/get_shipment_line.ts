import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmShipmentLineOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  shipmentLineKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived shipmentLineKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetShipmentLineTool: InternalToolConfig<
  OracleFusionScmDetailParams<'shipmentLineKey'>,
  OracleFusionScmDetailResponse<'shipmentLine'>
> = {
  id: 'oracle_fusion_scm_get_shipment_line',
  name: 'Oracle Fusion SCM Get Shipment Line',
  description: 'Get one shipment line by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    shipmentLine: {
      type: 'object',
      description: 'The shipment line returned by Oracle',
      properties: oracleFusionScmShipmentLineOutputProperties,
    },
  },
}
