import type {
  OracleEpmEdmDeleteRequestParams,
  OracleEpmEdmDeleteRequestResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmDeleteRequestTool: InternalToolConfig<
  OracleEpmEdmDeleteRequestParams,
  OracleEpmEdmDeleteRequestResponse
> = {
  id: 'oracle_epm_edm_delete_request',
  name: 'Oracle EDM Delete Request',
  description: 'Delete an EDM request when permitted by Oracle.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    requestId: edmParam('string', true, 'Request UUID; for node listing it requires request scope'),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_delete_request', params) },
  outputs: {
    requestId: edmOutputs.requestId,
    deleted: edmOutputs.deleted,
  },
}
