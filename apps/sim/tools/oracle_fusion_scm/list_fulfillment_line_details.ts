import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmFinderListParamFields,
  oracleFusionScmFulfillmentLineDetailOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmListResponse,
  OracleFusionScmParentListParams,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  ...oracleFusionScmFinderListParamFields,
  salesOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived salesOrderKey; preserve the key exactly'
  ),
  salesOrderLineKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived salesOrderLineKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmListFulfillmentLineDetailsTool: InternalToolConfig<
  OracleFusionScmParentListParams<'salesOrderKey' | 'salesOrderLineKey'>,
  OracleFusionScmListResponse
> = {
  id: 'oracle_fusion_scm_list_fulfillment_line_details',
  name: 'Oracle Fusion SCM List Fulfillment Line Details',
  description:
    'List one bounded page of fulfillment line details under the selected parent. q and finder are mutually exclusive.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Fulfillment Line Details in this bounded page',
      items: { type: 'object', properties: oracleFusionScmFulfillmentLineDetailOutputProperties },
    },
    count: { type: 'number', description: 'Records in this page' },
    hasMore: { type: 'boolean', description: 'Whether another page exists' },
    limit: { type: 'number', description: 'Page size returned by Oracle' },
    offset: { type: 'number', description: 'Offset returned by Oracle' },
    totalResults: {
      type: 'number',
      description: 'Estimated total matching records, when provided by Oracle',
      optional: true,
    },
    nextOffset: {
      type: 'number',
      description: 'Offset for the next page, present only when another page exists',
      optional: true,
    },
  },
}
