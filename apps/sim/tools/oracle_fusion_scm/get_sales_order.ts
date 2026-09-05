import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmSalesOrderOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  salesOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived salesOrderKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetSalesOrderTool: InternalToolConfig<
  OracleFusionScmDetailParams<'salesOrderKey'>,
  OracleFusionScmDetailResponse<'salesOrder'>
> = {
  id: 'oracle_fusion_scm_get_sales_order',
  name: 'Oracle Fusion SCM Get Sales Order',
  description: 'Get one sales order using Oracle-derived keys.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    salesOrder: {
      type: 'object',
      description: 'The sales order returned by Oracle',
      properties: oracleFusionScmSalesOrderOutputProperties,
    },
  },
}
