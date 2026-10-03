import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmFinderListParamFields,
  oracleFusionScmItemOutputProperties,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmListParams,
  OracleFusionScmListResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  ...oracleFusionScmFinderListParamFields,
} satisfies ToolConfig['params']

export const oracleFusionScmListItemsTool: InternalToolConfig<
  OracleFusionScmListParams,
  OracleFusionScmListResponse
> = {
  id: 'oracle_fusion_scm_list_items',
  name: 'Oracle Fusion SCM List Items',
  description: 'List one bounded page of items using a fixed safe projection.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Items in this bounded page',
      items: { type: 'object', properties: oracleFusionScmItemOutputProperties },
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
