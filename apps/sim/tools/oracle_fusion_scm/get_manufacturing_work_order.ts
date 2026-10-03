import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmManufacturingWorkOrderOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  manufacturingWorkOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived manufacturingWorkOrderKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetManufacturingWorkOrderTool: InternalToolConfig<
  OracleFusionScmDetailParams<'manufacturingWorkOrderKey'>,
  OracleFusionScmDetailResponse<'manufacturingWorkOrder'>
> = {
  id: 'oracle_fusion_scm_get_manufacturing_work_order',
  name: 'Oracle Fusion SCM Get Manufacturing Work Order',
  description: 'Get one manufacturing work order by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    manufacturingWorkOrder: {
      type: 'object',
      description: 'The manufacturing work order returned by Oracle',
      properties: oracleFusionScmManufacturingWorkOrderOutputProperties,
    },
  },
}
