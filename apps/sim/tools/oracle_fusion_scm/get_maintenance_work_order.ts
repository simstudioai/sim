import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmMaintenanceWorkOrderOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  maintenanceWorkOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived maintenanceWorkOrderKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetMaintenanceWorkOrderTool: InternalToolConfig<
  OracleFusionScmDetailParams<'maintenanceWorkOrderKey'>,
  OracleFusionScmDetailResponse<'maintenanceWorkOrder'>
> = {
  id: 'oracle_fusion_scm_get_maintenance_work_order',
  name: 'Oracle Fusion SCM Get Maintenance Work Order',
  description: 'Get one maintenance work order by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    maintenanceWorkOrder: {
      type: 'object',
      description: 'The maintenance work order returned by Oracle',
      properties: oracleFusionScmMaintenanceWorkOrderOutputProperties,
    },
  },
}
