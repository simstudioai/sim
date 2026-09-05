import type {
  OracleEpmEdmListNodeTypesParams,
  OracleEpmEdmListNodeTypesResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmListNodeTypesTool: InternalToolConfig<
  OracleEpmEdmListNodeTypesParams,
  OracleEpmEdmListNodeTypesResponse
> = {
  id: 'oracle_epm_edm_list_node_types',
  name: 'Oracle EDM List Node Types',
  description:
    'List node-type references assigned to a viewpoint; this is not an administration API.',
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
    viewpointId: edmParam('string', true, 'Viewpoint UUID'),
    maxResults: edmParam(
      'number',
      false,
      'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_list_node_types', params) },
  outputs: {
    nodeTypes: edmOutputs.nodeTypes,
  },
}
