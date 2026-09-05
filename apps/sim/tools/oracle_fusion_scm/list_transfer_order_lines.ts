import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmFinderListParamFields,
  oracleFusionScmOpaqueKeyParam,
  oracleFusionScmTransferOrderLineOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmListResponse,
  OracleFusionScmParentListParams,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  ...oracleFusionScmFinderListParamFields,
  transferOrderKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transferOrderKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmListTransferOrderLinesTool: InternalToolConfig<
  OracleFusionScmParentListParams<'transferOrderKey'>,
  OracleFusionScmListResponse
> = {
  id: 'oracle_fusion_scm_list_transfer_order_lines',
  name: 'Oracle Fusion SCM List Transfer Order Lines',
  description:
    'List one bounded page of transfer order lines under the selected parent. q and finder are mutually exclusive.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Transfer Order Lines in this bounded page',
      items: { type: 'object', properties: oracleFusionScmTransferOrderLineOutputProperties },
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
