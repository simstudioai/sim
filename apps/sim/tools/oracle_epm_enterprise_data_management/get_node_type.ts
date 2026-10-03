import type {
  OracleEpmEdmGetNodeTypeParams,
  OracleEpmEdmGetNodeTypeResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetNodeTypeTool: InternalToolConfig<
  OracleEpmEdmGetNodeTypeParams,
  OracleEpmEdmGetNodeTypeResponse
> = {
  id: 'oracle_epm_edm_get_node_type',
  name: 'Oracle EDM Get Node Type',
  description: 'Get a node-type reference and related viewpoints from a viewpoint assignment.',
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
    nodeTypeId: edmParam('string', true, 'Node-type UUID assigned to the selected viewpoint'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_node_type', params) },
  outputs: {
    nodeType: edmOutputs.nodeType,
  },
}
