import type {
  OracleEpmEdmListNodesParams,
  OracleEpmEdmListNodesResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmListNodesTool: InternalToolConfig<
  OracleEpmEdmListNodesParams,
  OracleEpmEdmListNodesResponse
> = {
  id: 'oracle_epm_edm_list_nodes',
  name: 'Oracle EDM List Nodes',
  description: 'List one bounded flat page of all, top, child, or request-context nodes.',
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
    scope: edmParam(
      'string',
      false,
      'Node listing scope (default top); children requires parentNodeId, request requires requestId. Allowed values: top, all, children, request.'
    ),
    parentNodeId: edmParam('string', false, 'Parent node UUID for children scope only'),
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
    limit: edmParam('number', false, 'Node page size (1-100; default 50)'),
    offset: edmParam('number', false, 'Node page offset (0-1000000; default 0)'),
    fromId: edmParam(
      'string',
      false,
      'Nodes after this node UUID; append * to include it, or use first. Cannot combine with toId.'
    ),
    toId: edmParam(
      'string',
      false,
      'Nodes before this node UUID; append * to include it, or use last. Cannot combine with fromId.'
    ),
    orderBy: edmParam(
      'string',
      false,
      'Hierarchy-set node order. Allowed values: hsConfig:asc, hsConfig:desc.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_list_nodes', params) },
  outputs: {
    nodes: edmOutputs.nodes,
    count: edmOutputs.count,
    offset: edmOutputs.offset,
    hasMore: edmOutputs.hasMore,
    nextOffset: edmOutputs.nextOffset,
    truncated: edmOutputs.truncated,
  },
}
