import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmFinderListParamFields,
  oracleFusionScmOnHandQuantityOutputProperties,
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

export const oracleFusionScmListOnHandQuantitiesTool: InternalToolConfig<
  OracleFusionScmListParams,
  OracleFusionScmListResponse
> = {
  id: 'oracle_fusion_scm_list_on_hand_quantities',
  name: 'Oracle Fusion SCM List On Hand Quantities',
  description: 'List one bounded page of on-hand quantity details using a fixed safe projection.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    items: {
      type: 'array',
      description: 'On Hand Quantities in this bounded page',
      items: { type: 'object', properties: oracleFusionScmOnHandQuantityOutputProperties },
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
