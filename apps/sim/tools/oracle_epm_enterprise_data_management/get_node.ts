import type {
  OracleEpmEdmGetNodeParams,
  OracleEpmEdmGetNodeResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetNodeTool: InternalToolConfig<
  OracleEpmEdmGetNodeParams,
  OracleEpmEdmGetNodeResponse
> = {
  id: 'oracle_epm_edm_get_node',
  name: 'Oracle EDM Get Node',
  description: 'Get an EDM node and its documented properties and request validation information.',
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
    nodeId: edmParam('string', true, 'Node UUID'),
    requestId: edmParam(
      'string',
      false,
      'Request UUID; for node listing it requires request scope'
    ),
    expand: edmParam(
      'string',
      false,
      'One documented node expansion. Allowed values: propertyValues::none, propertyValues::all, propertyValues::columnVisible, propertyValues::locationVisible, requestItem.validations, bestLocationRtl.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_node', params) },
  outputs: {
    node: edmOutputs.node,
  },
}
