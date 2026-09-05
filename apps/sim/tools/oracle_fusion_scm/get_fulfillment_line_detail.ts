import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmFulfillmentLineDetailOutputProperties,
  oracleFusionScmOpaqueKeyParam,
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
  fulfillmentLineDetailKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived fulfillmentLineDetailKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetFulfillmentLineDetailTool: InternalToolConfig<
  OracleFusionScmDetailParams<'salesOrderKey' | 'salesOrderLineKey' | 'fulfillmentLineDetailKey'>,
  OracleFusionScmDetailResponse<'fulfillmentLineDetail'>
> = {
  id: 'oracle_fusion_scm_get_fulfillment_line_detail',
  name: 'Oracle Fusion SCM Get Fulfillment Line Detail',
  description:
    'Get one fulfillment line detail using Oracle-derived keys within its selected parent.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    fulfillmentLineDetail: {
      type: 'object',
      description: 'The fulfillment line detail returned by Oracle',
      properties: oracleFusionScmFulfillmentLineDetailOutputProperties,
    },
  },
}
