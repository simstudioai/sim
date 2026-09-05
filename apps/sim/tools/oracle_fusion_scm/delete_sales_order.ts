import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmDetailParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  salesOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived salesOrderKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmDeleteSalesOrderTool: InternalToolConfig<
  OracleFusionScmDetailParams<'salesOrderKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_delete_sales_order',
  name: 'Oracle Fusion SCM Delete Sales Order',
  description:
    'Delete an Oracle sales order when its lifecycle and permissions allow deletion. This is not a cancellation operation.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether Oracle completed the deletion' },
    salesOrderKey: { type: 'string', description: 'Deleted sales order key' },
  },
}
