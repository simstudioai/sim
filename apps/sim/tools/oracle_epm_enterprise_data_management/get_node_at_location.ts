import type {
  OracleEpmEdmGetNodeAtLocationParams,
  OracleEpmEdmGetNodeAtLocationResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetNodeAtLocationTool: InternalToolConfig<
  OracleEpmEdmGetNodeAtLocationParams,
  OracleEpmEdmGetNodeAtLocationResponse
> = {
  id: 'oracle_epm_edm_get_node_at_location',
  name: 'Oracle EDM Get Node At Location',
  description: 'Get a node at its comma-separated ancestor/node UUID location.',
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
    location: edmParam(
      'string',
      true,
      'Comma-separated ancestor/node UUIDs, root first (maximum 255 characters)'
    ),
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
  operation: {
    input: (params) => edmOperationInput('oracle_epm_edm_get_node_at_location', params),
  },
  outputs: {
    node: edmOutputs.node,
  },
}
