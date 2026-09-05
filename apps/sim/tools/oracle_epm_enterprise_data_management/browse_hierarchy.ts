import type {
  OracleEpmEdmBrowseHierarchyParams,
  OracleEpmEdmBrowseHierarchyResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmHierarchyOutput,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmBrowseHierarchyTool: InternalToolConfig<
  OracleEpmEdmBrowseHierarchyParams,
  OracleEpmEdmBrowseHierarchyResponse
> = {
  id: 'oracle_epm_edm_browse_hierarchy',
  name: 'Oracle EDM Browse Hierarchy',
  description:
    'Browse a bounded flat hierarchy preserving shared-node occurrences, with a 5 MiB node-output cap and remaining-frontier diagnostics.',
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
    maxDepth: edmParam(
      'number',
      false,
      'Maximum traversal depth (0-3; default 2); roots have depth zero'
    ),
    maxNodes: edmParam('number', false, 'Maximum hierarchy occurrences (1-500; default 200)'),
    pageSize: edmParam('number', false, 'Hierarchy provider page size (1-100; default 50)'),
    maxRequests: edmParam(
      'number',
      false,
      'Maximum hierarchy provider requests (1-100; default 50)'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_browse_hierarchy', params) },
  outputs: {
    nodes: edmHierarchyOutput,
    count: edmOutputs.count,
    providerRequests: edmOutputs.providerRequests,
    truncated: edmOutputs.truncated,
    truncationReasons: edmOutputs.truncationReasons,
    remainingFrontier: edmOutputs.remainingFrontier,
  },
}
