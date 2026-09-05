import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmSalesOrderLineOutputProperties,
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
  salesOrderLineKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived salesOrderLineKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetSalesOrderLineTool: InternalToolConfig<
  OracleFusionScmDetailParams<'salesOrderKey' | 'salesOrderLineKey'>,
  OracleFusionScmDetailResponse<'salesOrderLine'>
> = {
  id: 'oracle_fusion_scm_get_sales_order_line',
  name: 'Oracle Fusion SCM Get Sales Order Line',
  description: 'Get one sales order line using Oracle-derived keys within its selected parent.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    salesOrderLine: {
      type: 'object',
      description: 'The sales order line returned by Oracle',
      properties: oracleFusionScmSalesOrderLineOutputProperties,
    },
  },
}
