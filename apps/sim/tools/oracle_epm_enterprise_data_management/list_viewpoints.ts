import type {
  OracleEpmEdmListViewpointsParams,
  OracleEpmEdmListViewpointsResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmListViewpointsTool: InternalToolConfig<
  OracleEpmEdmListViewpointsParams,
  OracleEpmEdmListViewpointsResponse
> = {
  id: 'oracle_epm_edm_list_viewpoints',
  name: 'Oracle EDM List Viewpoints',
  description: 'List viewpoints in a view, optionally filtered by application or dimension.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    viewId: edmParam('string', true, 'View UUID'),
    dimensionId: edmParam('string', false, 'Dimension UUID'),
    applicationId: edmParam('string', false, 'Application UUID'),
    maxResults: edmParam(
      'number',
      false,
      'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_list_viewpoints', params) },
  outputs: {
    viewpoints: edmOutputs.viewpoints,
  },
}
