import type {
  OracleEpmEdmListDimensionsParams,
  OracleEpmEdmListDimensionsResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmListDimensionsTool: InternalToolConfig<
  OracleEpmEdmListDimensionsParams,
  OracleEpmEdmListDimensionsResponse
> = {
  id: 'oracle_epm_edm_list_dimensions',
  name: 'Oracle EDM List Dimensions',
  description: "List dimensions and bindings from a selected application's documented metadata.",
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    applicationId: edmParam('string', true, 'Application UUID'),
    maxResults: edmParam(
      'number',
      false,
      'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_list_dimensions', params) },
  outputs: {
    applicationId: edmOutputs.applicationId,
    dimensions: edmOutputs.dimensions,
  },
}
