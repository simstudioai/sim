import type {
  OracleEpmEdmListViewsParams,
  OracleEpmEdmListViewsResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmListViewsTool: InternalToolConfig<
  OracleEpmEdmListViewsParams,
  OracleEpmEdmListViewsResponse
> = {
  id: 'oracle_epm_edm_list_views',
  name: 'Oracle EDM List Views',
  description: 'List EDM views, optionally filtered by one dimension or object status.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    dimensionId: edmParam('string', false, 'Dimension UUID'),
    objectStatus: edmParam(
      'string',
      false,
      'One view status filter. Allowed values: DRAFT, ACTIVE, ARCHIVED.'
    ),
    maxResults: edmParam(
      'number',
      false,
      'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_list_views', params) },
  outputs: {
    views: edmOutputs.views,
  },
}
