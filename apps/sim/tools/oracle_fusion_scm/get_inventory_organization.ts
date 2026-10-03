import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmInventoryOrganizationOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  organizationKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived organizationKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetInventoryOrganizationTool: InternalToolConfig<
  OracleFusionScmDetailParams<'organizationKey'>,
  OracleFusionScmDetailResponse<'organization'>
> = {
  id: 'oracle_fusion_scm_get_inventory_organization',
  name: 'Oracle Fusion SCM Get Inventory Organization',
  description: 'Get one inventory organization by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    organization: {
      type: 'object',
      description: 'The inventory organization returned by Oracle',
      properties: oracleFusionScmInventoryOrganizationOutputProperties,
    },
  },
}
